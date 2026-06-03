import { DataTypes } from "sequelize";
import { sequelize } from "../db/client.js";

const Integration = sequelize.define("integration", {
  integrationId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: "users",
      key: "userId",
    },
    onDelete: "CASCADE",
  },

  provider: {
    type: DataTypes.STRING,
    allowNull: false,
  },

  accessToken: {
    type: DataTypes.TEXT,
  },

  refreshToken: {
    type: DataTypes.TEXT,
  },

  connected: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },

  metadata: {
    type: DataTypes.JSON,
  },

  expiresAt: {
    type: DataTypes.DATE,
  },
});

export default Integration;

// The Integration model answers: "when the LLM says 'call send_email', do we actually have a valid Gmail connection for this user, and what token do we use?"
