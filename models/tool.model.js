import { DataTypes } from "sequelize";
import { sequelize } from "../db/client.js";

const Tool = sequelize.define("tool", {
  toolId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  name: DataTypes.STRING,

  provider: DataTypes.STRING,
    
  description: DataTypes.TEXT,

  parameters: DataTypes.JSON, // LLM uses this to know what arguments to extract

  enabled: DataTypes.BOOLEAN,
});

export default Tool;

