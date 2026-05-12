import { DataTypes } from "sequelize";
import { sequelize } from "../db/client.js";

const Message = sequelize.define("message", {
  messageId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  conversationId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: "conversations", key: "conversationId" },
    onDelete: "CASCADE",
  },

  role: { type: DataTypes.ENUM("user", "assistant"), allowNull: false },

  model: DataTypes.STRING,

  content: DataTypes.TEXT, // LLM generated response
});

export default Message;
