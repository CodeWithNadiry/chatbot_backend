import { Sequelize } from "sequelize";
import { configData } from "../config/config.js";

const { database, username, password, host, dialect } = configData;

export const sequelize = new Sequelize(database, username, password, {
  host,
  dialect,
  logging: false,
  define: {
    timestamps: true,
  },
});

export const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log("DB connected");
  } catch (error) {
    console.error("DB connection failed", error);
    process.exit(1);
  }
};
