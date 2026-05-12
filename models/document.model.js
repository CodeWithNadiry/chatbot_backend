import { DataTypes } from "sequelize";
import { sequelize } from "../db/client.js";

const Document = sequelize.define("document", {
  documentId: {
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
    onDelete: "CASCADE", // If a User is deleted, all their Documents will be deleted (CASCADE)
  },

  fileName: { type: DataTypes.STRING, allowNull: false },

  filePath: { type: DataTypes.TEXT, allowNull: false },

  fileType: { type: DataTypes.STRING }, // (e.g., .pdf, .txt, .docx)

  status: {
    type: DataTypes.ENUM("pending", "processing", "completed", "failed"),
    defaultValue: "pending",
  },

});

export default Document;
