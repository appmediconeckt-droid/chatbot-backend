// import app from "./src/app.js";
// import server from "./src/app.js"; 
// import mongoose from "mongoose";
// import dotenv from "dotenv";

// dotenv.config();

// mongoose.connect(process.env.MONGO_URI)
// .then(() => {
//     console.log("MongoDB Connected");

//     app.listen(process.env.PORT, () => {
//         console.log(`Server running on port ${process.env.PORT}`);
//     });
// })
// .catch(err => console.log(err));


// index.js or server.js
// import server from "./src/app.js";
// import mongoose from "mongoose";
// import dotenv from "dotenv";


// // Add this to your app.js or server.js temporarily
// console.log('JWT_SECRET loaded:', process.env.JWT_SECRET ? 'YES (length: ' + process.env.JWT_SECRET.length + ')' : 'NO');
// console.log('JWT_SECRET value:', process.env.JWT_SECRET);
// dotenv.config();

// const PORT = process.env.PORT || 5000;

// mongoose.connect(process.env.MONGO_URI)
//   .then(() => {
//     console.log("MongoDB Connected");
    
//     server.listen(PORT, () => {
//       console.log(`Server running on port ${PORT}`);
//     });
//   })
//   .catch(err => {
//     console.error("MongoDB connection error:", err);
//     process.exit(1);
//   });

// index.js or server.js
import server from "./src/app.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "node:dns";
import connectDB from "./src/config/db.js";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

// IMPORTANT: Load environment variables FIRST
dotenv.config();

const PORT = process.env.PORT || 5000;

// Connect to MongoDB using cached connection
connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`📡 API URL: http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });