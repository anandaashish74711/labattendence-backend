const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());


// Create a connection pool
const db = mysql.createPool({
    host: "10.2.216.199",
    user: "test",
    password: "test123",
    database: "labattendance",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Function to test DB connection
function checkDatabaseConnection() {
    db.getConnection((err, connection) => {
        if (err) {
            console.error("\n❌ Database Connection Failed!");
            console.error("   🔹 Error Code: ", err.code);
            console.error("   🔹 SQL Message: ", err.message || "N/A");
            console.error("   🔹 Stack Trace: \n", err.stack);
            return;
        }
        console.log("✅ Connected to MariaDB!");
        connection.release();
    });
}

// Auto-reconnect on 'PROTOCOL_CONNECTION_LOST'
db.on("error", (err) => {
    console.error("⚠️ MySQL Pool Error:", err);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
        console.log("🔄 Attempting to reconnect...");
        setTimeout(checkDatabaseConnection, 5000); // Retry after 5s
    }
});

// Run the connection test
checkDatabaseConnection();

module.exports = db;

// Helper function to calculate days between dates (inclusive)
function getDaysBetweenDates(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
}

app.get("/attendance", (req, res) => {
    const query = `
        SELECT 
    u.userid, 
    u.username, 
    ar.checkin, 
    ar.checkout, 
    ar.duration
FROM tbl_attendance_record ar
JOIN tbl_user_master u ON ar.userid = u.userid
WHERE DATE(ar.checkin) = CURDATE()
ORDER BY ar.checkin DESC;

    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error("Query error:", err);
            return res.status(500).json({ 
                error: "Database query failed",
                details: err.message 
            });
        }

        // Format the response data
        const formattedResults = results.map(record => ({
            userid: record.userid,
            username: record.username,
            checkin: record.checkin ? new Date(record.checkin).toISOString() : null,
            checkout: record.checkout ? new Date(record.checkout).toISOString() : null,
            duration: record.duration,
            attendance_date: record.attendance_date ? new Date(record.attendance_date).toISOString().split('T')[0] : null
        }));

        res.json({
            current_date: new Date().toISOString().split('T')[0],
            total_records: results.length,
            records: formattedResults
        });
    });
});
app.get("/attendance-by-date", (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ 
            error: "A valid date parameter is required",
            example: "/attendance-by-date?date=2025-02-01"
        });
    }

    const query = `
   WITH RankedAttendance AS (
    SELECT 
        u.userid, 
        u.username, 
        ar.checkin, 
        ar.checkout, 
        CASE 
            WHEN ar.entrystat = 1 AND ar.exitstat = 1 THEN ar.duration 
            ELSE NULL 
        END AS duration,
        wo.overtime,
        ROW_NUMBER() OVER (PARTITION BY u.userid ORDER BY ar.checkin DESC) AS rn
    FROM tbl_attendance_record ar
    JOIN tbl_user_master u ON ar.userid = u.userid
    LEFT JOIN tbl_work_overtime wo ON ar.userid = wo.userid
    WHERE DATE(ar.checkin) = ?
)
SELECT userid, username, checkin, checkout, duration, overtime
FROM RankedAttendance
WHERE rn = 1;


    `;

    db.query(query, [date], (err, results) => {
        if (err) {
            console.error("Query error:", err);
            return res.status(500).json({ 
                error: "Database query failed",
                details: err.message 
            });
        }

        // Format the response data
        const formattedResults = results.map(record => ({
            userid: record.userid,
            username: record.username,
            checkin: record.checkin ? new Date(record.checkin).toISOString() : null,
            checkout: record.checkout ? new Date(record.checkout).toISOString() : null,
            duration: record.duration,
            overtime: record.overtime ? new Date(record.overtime).toISOString() : null
        }));

        res.json({
            requested_date: date,
            total_records: results.length,
            records: formattedResults
        });
    });
});


// Updated endpoint with correct average calculation
app.get("/total-hours-by-date-range", (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ 
            error: "Both startDate and endDate are required",
            example: "/total-hours-by-date-range?startDate=2025-01-28&endDate=2025-01-30"
        });
    }

    const totalDaysInRange = getDaysBetweenDates(startDate, endDate);

    const query = `
        SELECT 
            u.userid,
            u.username,
            COUNT(DISTINCT DATE(ar.checkin)) as days_present,
            SUM(ar.duration) as total_hours,
            MIN(ar.checkin) as first_checkin,
            MAX(ar.checkout) as last_checkout
        FROM tbl_attendance_record ar
        JOIN tbl_user_master u ON ar.userid = u.userid
        WHERE 
            DATE(ar.checkin) BETWEEN ? AND ?
            AND ar.duration IS NOT NULL
        GROUP BY u.userid, u.username
        ORDER BY u.username;
    `;

    db.query(query, [startDate, endDate], (err, results) => {
        if (err) {
            console.error("Query error:", err);
            return res.status(500).json({ error: "Database query failed" });
        }

        // Process the results to format dates and calculate correct averages
        const processedResults = results.map(record => ({
            userid: record.userid,
            username: record.username,
            days_present: record.days_present,
            total_hours: record.total_hours,
            average_hours_per_day: record.days_present > 0 
                ? (record.total_hours / record.days_present).toFixed(2)  // Corrected average calculation
                : "0.00",
            days_absent: totalDaysInRange - record.days_present,
            first_checkin: record.first_checkin ? new Date(record.first_checkin).toISOString() : null,
            last_checkout: record.last_checkout ? new Date(record.last_checkout).toISOString() : null
        }));

        res.json({
            date_range: {
                from: startDate,
                to: endDate,
                total_days: totalDaysInRange
            },
            records: processedResults
        });
    });






});
app.post("/login", (req, res) => {
    const { loginid, loginpassword } = req.body;
    console.log("Request body:", req.body);


    console.log("Received loginid:", loginid);  // Debug log
    console.log("Received loginpassword:", loginpassword);  // Debug log

    if (!loginid || !loginpassword) {
        return res.status(400).json({ error: "Both loginid and loginpassword are required" });
    }

    const query = "SELECT * FROM tbl_login_info WHERE loginid = ? AND loginpassword = ?";
    db.query(query, [loginid.trim(), loginpassword.trim()], (err, results) => {
        if (err) {
            console.error("Database query failed:", err);
            return res.status(500).json({ error: "Internal server error" });
        }

        if (results.length === 0) {
            return res.status(401).json({ error: "Invalid login credentials" });
        }

        res.json({
            message: "Login successful",
            user: { loginid: results[0].loginid }
        });
    });
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));