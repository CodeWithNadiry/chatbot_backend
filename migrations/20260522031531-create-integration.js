export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('integrations', {
    integrationId: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },

    userId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'userId',
      },
      onDelete: 'CASCADE',
    },

    provider: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    accessToken: {
      type: Sequelize.TEXT,
    },

    refreshToken: {
      type: Sequelize.TEXT,
    },

    connected: {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
    },

    metadata: {
      type: Sequelize.JSON,
    },

    expiresAt: {
      type: Sequelize.DATE,
    },

    createdAt: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },

    updatedAt: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
  });
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.dropTable('integrations');
}