export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    ALTER TABLE messages
    ALTER COLUMN "conversationId" DROP NOT NULL;
  `);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(`
    ALTER TABLE messages
    ALTER COLUMN "conversationId" SET NOT NULL;
  `);
}