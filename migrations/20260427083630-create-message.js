export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable("messages", {
    messageId: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },

    conversationId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: "conversations",
        key: "conversationId",
      },
      onDelete: "CASCADE",
    },

    role: {
      type: Sequelize.ENUM("user", "assistant"),
      allowNull: false,
    },

    model: {
      type: Sequelize.STRING,
    },

    content: {
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
  await queryInterface.dropTable("messages");
  await queryInterface.sequelize.query(
    'DROP TYPE IF EXISTS "enum_messages_role"',
  );
}
