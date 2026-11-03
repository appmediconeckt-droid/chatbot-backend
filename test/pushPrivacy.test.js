import { expect } from "chai";
import { privatePushContent } from "../src/services/pushPrivacy.js";

describe("iOS push minimization", () => {
  for (const platform of ["ios", undefined, "unknown"]) {
    it(`removes clinical text, identities and arbitrary fields for ${platform}`, () => {
      const result = privatePushContent({ platform, title: "Private patient", body: "Clinical text",
        data: { type: "CHAT_MESSAGE", chatId: "opaque-id", body: "Clinical text", content: "Secret",
          senderName: "Private patient", userPhoto: "private-url", prescription: "Secret", nested: { health: true } } });
      expect(result.data).to.deep.equal({ type: "CHAT_MESSAGE", chatId: "opaque-id" });
      expect(JSON.stringify(result)).not.to.match(/Private patient|Clinical text|private-url|Secret/);
    });
  }
  it("keeps call routing without transmitting caller names", () => {
    expect(privatePushContent({ platform: "ios", data: { type: "INCOMING_CALL", callId: "call", callerId: "caller", callerName: "Private" } }).data)
      .to.deep.equal({ type: "INCOMING_CALL", callId: "call", callerId: "caller" });
  });
  it("preserves the existing Android presentation", () => {
    const content = { platform: "android", title: "Title", body: "Body", data: { senderName: "Name" } };
    expect(privatePushContent(content)).to.deep.equal({ title: content.title, body: content.body, data: content.data });
  });
});
