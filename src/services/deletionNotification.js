// Called only after local erasure and verified provider/backup checkpoints.
const deletionNotification = {
  async send(email) {
    if (!email || !email.includes("@")) throw new Error("Deletion confirmation recipient unavailable");
    const { sendTransactionalEmail } = await import("./otpService.js");
    await sendTransactionalEmail({
      to: email, subject: "Humaeli account deletion confirmed",
      text: "Your Humaeli account deletion has been completed. Contact support@humaeli.com if you have questions.",
      html: "<p>Your Humaeli account deletion has been completed.</p><p>Contact support@humaeli.com if you have questions.</p>",
    });
  },
};
export default deletionNotification;
