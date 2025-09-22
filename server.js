const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173", // Local development
      "https://tsucare.netlify.app", // Production frontend
      "http://localhost:3000", // Android emulator
      "http://10.0.2.2:3000" // Android emulator localhost
    ],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// Map to store online users and their sockets
const userSocketMap = {};

// Function to get the socket id of the receiver
function getReceiverSocketId(receiverID) {
  return userSocketMap[receiverID];
}

// Validate environment variables
console.log('Environment variables check:');
console.log('MYSQLHOST:', process.env.MYSQLHOST ? '✅ Set' : '❌ Missing');
console.log('MYSQLUSER:', process.env.MYSQLUSER ? '✅ Set' : '❌ Missing');
console.log('MYSQLPASSWORD:', process.env.MYSQLPASSWORD ? '✅ Set' : '❌ Missing');
console.log('MYSQLDATABASE:', process.env.MYSQLDATABASE ? '✅ Set' : '❌ Missing');
console.log('MYSQLPORT:', process.env.MYSQLPORT ? '✅ Set' : '❌ Missing');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('PORT:', PORT);

// Middleware
app.use(cors());
app.use(express.json());

// Database connection - Railway uses different environment variable names
const dbConfig = {
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'railway',
  port: parseInt(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectTimeout: 60000,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
};

let db;

// Initialize database connection
async function initDatabase() {
  try {
    console.log('Attempting to connect to database with config:', {
      host: dbConfig.host,
      user: dbConfig.user,
      database: dbConfig.database,
      port: dbConfig.port
    });
    
    db = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to MySQL database successfully');
    
    // Verify student table exists (it should already be created in Railway)
    const [tables] = await db.execute("SHOW TABLES LIKE 'student'");
    if (tables.length === 0) {
      throw new Error('Student table not found in database');
    }
    console.log('✅ Student table ready');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.error('Database config used:', dbConfig);
    process.exit(1);
  }
}

// API Routes

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt for email:', email);
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find student by email
    const [rows] = await db.execute(
      'SELECT * FROM student WHERE email = ?',
      [email]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    const user = rows[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Return student data (without password)
    const { password: _, ...studentWithoutPassword } = user;
    
    res.json({
      success: true,
      message: 'Login successful',
      data: studentWithoutPassword
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Signup endpoint
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, studentNo, gender, email, password, college, program } = req.body;
    console.log('Signup attempt for email:', email, 'name:', name, 'studentNo:', studentNo);
    
    // Validate required fields
    if (!name || !studentNo || !gender || !email || !password || !college || !program) {
      return res.status(400).json({
        success: false,
        message: 'Name, studentNo, gender, email, password, college, and program are required'
      });
    }
    
    // Validate studentNo is a valid integer
    if (!Number.isInteger(Number(studentNo)) || Number(studentNo) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Student number must be a valid positive integer'
      });
    }
    
    // Check if student already exists by email or studentNo
    const [existingStudents] = await db.execute(
      'SELECT studentID FROM student WHERE email = ? OR studentNo = ?',
      [email, studentNo]
    );
    
    if (existingStudents.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Student with this email or student number already exists'
      });
    }
    
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Find counselor based on student's college
    console.log('Looking for counselor with college:', college);
    
    // First try exact match
    let [counselorRows] = await db.execute(
      'SELECT counselorID FROM counselor WHERE assignedCollege = ?',
      [college]
    );
    
    // If no exact match, try to find counselor who handles multiple colleges
    if (counselorRows.length === 0) {
      [counselorRows] = await db.execute(
        'SELECT counselorID FROM counselor WHERE assignedCollege LIKE ?',
        [`%${college}%`]
      );
    }
    
    console.log('Found counselors:', counselorRows);
    
    let counselorID = null;
    if (counselorRows.length > 0) {
      counselorID = counselorRows[0].counselorID;
      console.log('Assigned counselorID:', counselorID);
    } else {
      console.log('No counselor found for college:', college);
      // Use the counselor who handles all colleges (counselorID 1)
      counselorID = 1;
      console.log('Using default counselorID:', counselorID);
    }
    
    // Calculate OTP expiry date (30 days from now)
    const otpExpiryDate = new Date();
    otpExpiryDate.setDate(otpExpiryDate.getDate() + 30);
    
    // Insert new student with counselor assignment
    const [result] = await db.execute(
      'INSERT INTO student (name, studentNo, gender, email, password, college, program, counselorID, is_verified, otp, otp_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
      [name, studentNo, gender, email, hashedPassword, college, program, counselorID, '', otpExpiryDate]
    );
    
    // Get the created student
    const [newStudent] = await db.execute(
      'SELECT studentID, name, studentNo, gender, email, college, program, is_verified FROM student WHERE studentID = ?',
      [result.insertId]
    );
    
    res.status(201).json({
      success: true,
      message: 'Student created successfully',
      data: newStudent[0]
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'TSU Cares API is running',
    timestamp: new Date().toISOString(),
    onlineUsers: Object.keys(userSocketMap),
    userSocketMap: userSocketMap
  });
});

// Get all counselors for students
app.get('/api/counselors', async (req, res) => {
  try {
    const [counselors] = await db.execute(
      'SELECT counselorID, name, email, profession, assignedCollege FROM counselor WHERE is_verified = 1'
    );
    
    // Get online status for each counselor
    const counselorsWithStatus = counselors.map(counselor => ({
      ...counselor,
      isOnline: !!userSocketMap[counselor.counselorID],
      lastMessage: null,
      lastMessageTime: null,
      unreadCount: 0
    }));
    
    res.json({
      success: true,
      data: counselorsWithStatus
    });
  } catch (error) {
    console.error('Error fetching counselors:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get messages between student and counselor
app.get('/api/messages/:counselorId', async (req, res) => {
  try {
    const { counselorId } = req.params;
    const { studentId } = req.query;
    
    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: 'Student ID is required'
      });
    }
    
    const [messages] = await db.execute(
      'SELECT * FROM messages WHERE (counselorID = ? AND studentID = ?) ORDER BY timestamp ASC',
      [counselorId, studentId]
    );
    
    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Send message - Student ID comes from the logged-in user's session
app.post('/api/messages/:counselorId', async (req, res) => {
  try {
    const { message } = req.body;
    const { counselorId } = req.params;
    const { studentId } = req.query;
    
    console.log(`Send message request - Counselor ID: ${counselorId}, Student ID: ${studentId}, Message: ${message}`);
    
    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: 'Student ID is required'
      });
    }
    
    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }
    
    // Check if counselor exists
    const [counselorCheck] = await db.execute(
      'SELECT counselorID FROM counselor WHERE counselorID = ?',
      [counselorId]
    );
    
    if (counselorCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Counselor not found'
      });
    }
    
    // Insert the message into database
    const [result] = await db.execute(
      'INSERT INTO messages (counselorID, studentID, text, timestamp) VALUES (?, ?, ?, NOW())',
      [counselorId, studentId, message]
    );
    
    // Create the response object
    const newMessage = {
      messageID: result.insertId,
      counselorID: parseInt(counselorId),
      studentID: parseInt(studentId),
      text: message,
      timestamp: new Date().toISOString(),
      senderType: 'student' // This message was sent by the student
    };
    
    res.json({
      success: true,
      data: newMessage
    });
    
    // Emit real-time message to both counselor and student
    const receiverSocketId = getReceiverSocketId(counselorId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
      console.log(`Message sent to counselor ${counselorId}`);
    }
    
    const studentSocketId = getReceiverSocketId(studentId);
    if (studentSocketId) {
      io.to(studentSocketId).emit("newMessage", newMessage);
      console.log(`Message sent to student ${studentId}`);
    }
    
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Send message from counselor to student
app.post('/api/messages/counselor/:studentId', async (req, res) => {
  try {
    const { message } = req.body;
    const { studentId } = req.params;
    const { counselorId } = req.query;
    
    console.log(`Counselor send message request - Counselor ID: ${counselorId}, Student ID: ${studentId}, Message: ${message}`);
    
    if (!counselorId) {
      return res.status(400).json({
        success: false,
        message: 'Counselor ID is required'
      });
    }
    
    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }
    
    // Check if student exists
    const [studentCheck] = await db.execute(
      'SELECT studentID FROM student WHERE studentID = ?',
      [studentId]
    );
    
    if (studentCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }
    
    // Insert the message into database
    const [result] = await db.execute(
      'INSERT INTO messages (counselorID, studentID, text, timestamp) VALUES (?, ?, ?, NOW())',
      [counselorId, studentId, message]
    );
    
    // Create the response object
    const newMessage = {
      messageID: result.insertId,
      counselorID: parseInt(counselorId),
      studentID: parseInt(studentId),
      text: message,
      timestamp: new Date().toISOString(),
      senderType: 'counselor' // This message was sent by the counselor
    };
    
    res.json({
      success: true,
      data: newMessage
    });
    
    // Emit real-time message to both counselor and student
    const receiverSocketId = getReceiverSocketId(counselorId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
      console.log(`Message sent to counselor ${counselorId}`);
    }
    
    const studentSocketId = getReceiverSocketId(studentId);
    if (studentSocketId) {
      io.to(studentSocketId).emit("newMessage", newMessage);
      console.log(`Message sent to student ${studentId}`);
    }
    
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Socket.IO event handlers
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  console.log("Query params:", socket.handshake.query);
  
  const counselorID = socket.handshake.query.counselorID;
  const studentID = socket.handshake.query.studentID;
  const userID = counselorID || studentID;
  
  if (userID) {
    userSocketMap[userID] = socket.id;
    console.log(`User ${userID} connected with socket ${socket.id}`);
    console.log("Current online users:", Object.keys(userSocketMap));
  } else {
    console.log("No user ID provided in connection");
  }
  
  // Emit the online users to all clients
  io.emit("getOnlineUsers", Object.keys(userSocketMap));
  
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (userID) {
      delete userSocketMap[userID];
      console.log("Updated online users:", Object.keys(userSocketMap));
      io.emit("getOnlineUsers", Object.keys(userSocketMap));
    }
  });
});

// Start server
async function startServer() {
  try {
    await initDatabase();
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server is running on port ${PORT}`);
      console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
      console.log(`✅ Socket.IO server ready for real-time messaging`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        if (db) {
          db.end();
        }
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        if (db) {
          db.end();
        }
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
