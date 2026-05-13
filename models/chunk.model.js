import { DataTypes } from "sequelize";
import { sequelize } from "../db/client.js";

const Chunk = sequelize.define("chunk", {
  chunkId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  documentId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: "documents",
      key: "documentId",
    },
    onDelete: "CASCADE", // if  a document is deleted, all related chunks will also be deleted.
  },

  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: "users",
      key: "userId",
    },
    onDelete: 'CASCADE'
  },

  content: {
    type: DataTypes.TEXT,
    allowNull: false,
  },

  embedding: {
    type: DataTypes.JSONB,
  },

  chunkIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },

  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}, // stores chunk size and chunk overlap
  },
});

export default Chunk;
