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
    
    // Create users table if it doesn't exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Users table ready');
    
// Check if student table exists (it should already exist in Railway)
console.log('✅ Using existing student table');
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
    
    // Find student by email using existing table structure
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
    
    const student = rows[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, student.password);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Return student data (without password and sensitive fields)
    const { password: _, is_verified, otp, otp_expiry, ...studentWithoutPassword } = student;
    
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

// Signup endpoint - Save to existing student table
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, student_id, course, year_level, contact_number, gender } = req.body;
    console.log('Student signup attempt for email:', email, 'name:', name);
    
    if (!name || !email || !password || !student_id || !course || !year_level || !contact_number || !gender) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, password, student ID, course, year level, contact number, and gender are all required'
      });
    }
    
    // Check if student already exists
    console.log('Checking for existing student with email:', email);
    
    // Debug: Check all students in the table
    const [allStudents] = await db.execute('SELECT studentID, email FROM student');
    console.log('All students in database:', allStudents);
    
    const [existingStudents] = await db.execute(
      'SELECT studentID FROM student WHERE email = ?',
      [email]
    );
    console.log('Existing students found:', existingStudents.length);
    
    if (existingStudents.length > 0) {
      console.log('Student already exists with email:', email);
      return res.status(409).json({
        success: false,
        message: 'Student with this email already exists'
      });
    }
    
    // Also check if studentNo already exists
    const [existingStudentNo] = await db.execute(
      'SELECT studentID FROM student WHERE studentNo = ?',
      [student_id]
    );
    
    if (existingStudentNo.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Student ID already exists'
      });
    }
    
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Insert new student using existing table structure
    const [result] = await db.execute(
      'INSERT INTO student (name, email, password, studentNo, college, program, gender, counselorID) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, email, hashedPassword, student_id, course, year_level, gender, 1] // counselorID set to 1 as default
    );
    
    // Get the created student
    const [newStudent] = await db.execute(
      'SELECT studentID, name, email, studentNo, college, program, gender FROM student WHERE studentID = ?',
      [result.insertId]
    );
    
    res.status(201).json({
      success: true,
      message: 'Student account created successfully',
      data: newStudent[0]
    });
    
  } catch (error) {
    console.error('Student signup error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
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

// Debug endpoint to check all students
app.get('/api/debug/students', async (req, res) => {
  try {
    const [students] = await db.execute('SELECT studentID, name, email, studentNo, college, program, gender FROM student ORDER BY studentID DESC');
    res.json({
      success: true,
      count: students.length,
      students: students
    });
  } catch (error) {
    console.error('Debug students error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching students',
      error: error.message
    });
  }
});

// Debug endpoint to clear all students (for testing only)
app.delete('/api/debug/clear-students', async (req, res) => {
  try {
    await db.execute('DELETE FROM student');
    res.json({
      success: true,
      message: 'All students cleared from database'
    });
  } catch (error) {
    console.error('Clear students error:', error);
    res.status(500).json({
      success: false,
      message: 'Error clearing students',
      error: error.message
    });
  }
});

// Test database connection endpoint
app.get('/api/debug/test-db', async (req, res) => {
  try {
    const [result] = await db.execute('SELECT 1 as test');
    res.json({
      success: true,
      message: 'Database connection successful',
      test: result[0]
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: error.message
    });
  }
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
