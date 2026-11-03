// Moderation/reviewer involvement is not ownership of a clinical record.
// Deleting a reviewer's account must never erase another patient's prescription.
export const prescriptionAccountOwnershipFilter = (accountId, chatIds = []) => ({
  $or: [
    { patientId: accountId },
    { psychiatristId: accountId },
    ...(chatIds.length ? [{ chatId: { $in: chatIds } }] : []),
  ],
});
