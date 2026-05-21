import User from "../models/userModel.js";

export const resetAllUsersPresence = async () => {
  try {
    const result = await User.updateMany(
      { isOnline: true },
      { isOnline: false, lastSeen: new Date() }
    );
    console.log(`✅ Presence Reset: ${result.modifiedCount} users set to offline`);
    return result;
  } catch (error) {
    console.error("❌ Error resetting user presence:", error);
    throw error;
  }
};
