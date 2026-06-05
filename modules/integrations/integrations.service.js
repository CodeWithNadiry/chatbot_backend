import { google } from "googleapis";
import Integration from "../../models/integration.model.js";

const getOAuthClient = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
};

export const integrationService = {
  // this function returns a long secure URL string hosted by Google to frontend.
  getAuthUrl(userId) {
    if (!userId) {
      throw new Error("userId is required to generate auth URL");
    }

    const oauth2Client = getOAuthClient(); // oauth2Client is an object instance that manages your application's communication with Google's OAuth 2.0 servers

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline", // Force Google to issue a refresh token. This lets your application access the user's data even when the user is offline or away from their computer.

      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/gmail.send"],
      state: String(userId), // we pass userId so we know who to save the token for in callback
    });

    return url;
  },

  async handleCallback(code, userId) {
    const oauth2Client = getOAuthClient();

    const { tokens } = await oauth2Client.getToken(code);

    await Integration.upsert({
      userId,
      provider: "google",
      accessToken: tokens.access_token, // used to call Gmail API
      refreshToken: tokens.refresh_token, // used to get new access token when expired
      connected: true,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      metadata: { scope: tokens.scope },
    });
  },

  async disconnect(userId) {
    await Integration.update(
      { connected: false, accessToken: null, refreshToken: null },
      { where: { userId, provider: "google" } },
    );
  },

  async getStatus(userId) {
    const integration = await Integration.findOne({
      where: { userId, provider: "google" },
    });

    return {
      connected: integration?.connected || false,
      email: integration?.metadata?.email || null,
    };
  },
};
// The term upsert is a portmanteau of "update" and "insert". In database programming, table.upsert means "insert this row into the table, or if it already exists, update it instead."How it WorksWhen you execute an upsert operation, the database checks for a conflict against a unique identifier, such as a Primary Key or a Unique Index.If the key does NOT exist: The database treats it as a standard INSERT and creates a brand-new row.If the key ALREADY exists: The database intercepts the potential duplicate error and safely treats it as an UPDATE to modify the existing row's columns
