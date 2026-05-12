import { config } from "dotenv";
import { Sequelize } from "sequelize";
config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not defined");
}

export const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
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