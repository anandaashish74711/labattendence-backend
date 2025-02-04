const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: "10.2.216.199",
    user: "test",
    password: "test123",
    database: "labattendance"
});

db.connect((err) => {
    if (err) {
        console.error("Database connection failed:", err);
    } else {
        console.log("Connected to MariaDB");
    }
});

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
        SELECT 
            u.userid, 
            u.username, 
            ar.checkin, 
            ar.checkout, 
            ar.duration
        FROM tbl_attendance_record ar
        JOIN tbl_user_master u ON ar.userid = u.userid
        WHERE DATE(ar.checkin) = ?
        ORDER BY ar.checkin DESC;
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
            duration: record.duration
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

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
