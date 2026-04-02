import nodemailer from "nodemailer";

export const sendOtpMail=async(email,otp)=>{
    const transporter =nodemailer.createTransport({
        service:"gmail",
        auth:{
            user:process.env.EMAIL,
            pass:process.env.EMAIL_PASSWORD
        }
    });


    await transporter.sendMail({
        from:process.env.EMAIL,
        to:email,
        subject:"Email verification",
        text:`Your ot is ${otp}`
    })
}