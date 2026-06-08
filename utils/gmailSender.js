import { google } from "googleapis";
import Integration from "../models/integration.model.js";

const getOAuthClient = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
};

export async function sendEmail(userId, { to, subject, message }) {
  const integration = await Integration.findOne({
    where: { userId, provider: "google", connected: true },
  });

  if (!integration) {
    throw new Error(
      "Gmail not connected, Please connect your Gmail account first.",
    );
  }

  const oauth2Client = getOAuthClient();

  oauth2Client.setCredentials({
    access_token: integration.accessToken,
    refresh_token: integration.refreshToken,
  });

  oauth2Client.on("tokens", async (tokens) => { // This line of code sets up an event listener that automatically triggers whenever your OAuth client receives new authentication credentials. It ensures your application always uses the most up-to-date access credentials when making API requests on behalf of a user.
    if (tokens.access_token) {
      await integration.update({
        accessToken: tokens.access_token,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      });
    }
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client }); // This tells the Google library: "Create a Gmail API object and use this authenticated user when making requests.

  const rawEmail = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    message,
  ].join("\n");

  const encodedEmail = Buffer.from(rawEmail)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // const encodedEmail = Buffer.from(rawEmail).toString("base64url");x
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedEmail },
  });

  // Return the actual content that was sent
  return { to, subject, message };
}
