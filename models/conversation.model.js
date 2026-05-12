import { DataTypes } from "sequelize";
import { sequelize } from "../db/client.js";

const Conversation = sequelize.define("conversation", {
  conversationId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: "users", key: "userId" },
    onDelete: "CASCADE",
  },

  title: DataTypes.STRING,

  summary: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
});

export default Conversation;
