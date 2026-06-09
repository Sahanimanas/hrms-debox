# HR Management System

A comprehensive Human Resource Management System with a modern frontend and Node.js backend.

## Prerequisites

Before running this application, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v14 or higher)
- [Python 3](https://www.python.org/) (for serving frontend)
- [PM2](https://pm2.keymetrics.io/) (Process Manager for Node.js)

To install PM2 globally:

```bash
npm install -g pm2
```

## Getting Started

### Backend

Start the backend server using PM2:

```bash
pm2 start server.js --name hrm-backend
```

Useful PM2 commands:

```bash
pm2 status              # Check server status
pm2 logs hrm-backend    # View logs
pm2 restart hrm-backend # Restart server
pm2 stop hrm-backend    # Stop server
pm2 delete hrm-backend  # Remove from PM2
```

### Frontend

Navigate to the `dist/` directory and start a local server:

```bash
cd dist/
python3 -m http.server 4000
```

The frontend will be available at `http://localhost:4000`.

## Project Structure

```
├── dist/           # Frontend build files
├── server.js       # Backend entry point
├── package.json    # Node.js dependencies
└── README.md
```

## License

This project is licensed under the MIT License.



for frontend 
cd hr-management-frontend
then 
pm2 start "python3 http.server 4000" --name hrm-frontend-vite

