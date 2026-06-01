import User from "./user.model.js";
import Conversation from "./conversation.model.js";
import Message from "./message.model.js";
import Document from "./document.model.js";
import Chunk from "./chunk.model.js";
import Integration from "./integration.model.js";

export const initModels = () => {
  User.hasMany(Conversation, { foreignKey: "userId" });
  Conversation.belongsTo(User, { foreignKey: "userId" });

  Conversation.hasMany(Message, { foreignKey: "conversationId" });
  Message.belongsTo(Conversation, { foreignKey: "conversationId" });

  User.hasMany(Document, { foreignKey: "userId" });
  Document.belongsTo(User, { foreignKey: "userId" });

  Document.hasMany(Chunk, { foreignKey: "documentId" });
  Chunk.belongsTo(Document, { foreignKey: "documentId" });

  User.hasMany(Integration, {foreignKey: 'userId'});
  Integration.belongsTo(User, {foreignKey: 'userId'})
};