export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable("documents", {
    documentId: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },

    userId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "userId",
      },
      onDelete: "CASCADE",
    },

    fileName: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    filePath: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    fileType: {
      type: Sequelize.STRING,
    },

    status: {
      type: Sequelize.ENUM("pending", "processing", "completed", "failed"),
      defaultValue: "pending",
    },

    errorMessage: {
      type: Sequelize.TEXT,
    },

    createdAt: {
      allowNull: false,
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    },

    updatedAt: {
      allowNull: false,
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    },
  });
}

export async function down(queryInterface) {
  await queryInterface.dropTable("documents");
  await queryInterface.sequelize.query(
    'DROP TYPE IF EXISTS "enum_documents_status"',
  );
}
