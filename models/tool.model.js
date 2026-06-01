import { DataTypes } from "sequelize";
import { sequelize } from "../db/client";

const Tool = sequelize.define("tool", {
  toolId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  name: DataTypes.STRING,

  provider: DataTypes.STRING,
    
  description: DataTypes.TEXT,

  parameters: DataTypes.JSON,

  enabled: DataTypes.BOOLEAN,
});

export default Tool;

