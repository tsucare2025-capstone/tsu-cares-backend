const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
    timestamp: new Date().toISOString()
  });
});

// Start server
async function startServer() {
  try {
    await initDatabase();
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server is running on port ${PORT}`);
      console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
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
