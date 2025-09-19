// Test script to verify database connection
const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
  const dbConfig = {
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
    user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'railway',
    port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  };

  console.log('Testing database connection with config:', {
    host: dbConfig.host,
    user: dbConfig.user,
    database: dbConfig.database,
    port: dbConfig.port
  });

  try {
    const connection = await mysql.createConnection(dbConfig);
    console.log('✅ Database connection successful!');
    
    // Test a simple query
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('✅ Database query test successful:', rows);
    
    await connection.end();
    console.log('✅ Connection closed successfully');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.error('Make sure your environment variables are set correctly');
  }
}

testConnection();
