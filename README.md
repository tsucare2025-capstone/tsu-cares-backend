# TSU Cares Backend API

This is the backend API for the TSU Cares Android application, designed to be deployed on Railway.

## Setup Instructions

### 1. Deploy to Railway

1. Go to [Railway](https://railway.app)
2. Create a new project
3. Add a MySQL database service
4. Add a Node.js service
5. Connect your GitHub repository

### 2. Environment Variables

Railway automatically provides these environment variables when you add a MySQL database:

```
MYSQLHOST=mysql.railway.internal
MYSQLUSER=root
MYSQLPASSWORD=your-railway-password
MYSQLDATABASE=railway
MYSQLPORT=3306
NODE_ENV=production
PORT=3000
```

**Note**: Railway automatically sets these variables when you add a MySQL database service. You don't need to manually set them unless you want to override them.

### 3. Update Android App

Update the `BASE_URL` in `ApiClient.kt` with your Railway app URL:

```kotlin
private const val BASE_URL = "https://your-railway-app.railway.app/api/"
```

## API Endpoints

### POST /api/auth/login
Login with email and password

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "user@example.com",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### POST /api/auth/signup
Create a new user account

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "user@example.com",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### GET /api/health
Health check endpoint

**Response:**
```json
{
  "success": true,
  "message": "TSU Cares API is running",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Database Schema

The API automatically creates a `users` table with the following structure:

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Security Features

- Passwords are hashed using bcrypt
- CORS enabled for cross-origin requests
- Input validation
- Error handling
