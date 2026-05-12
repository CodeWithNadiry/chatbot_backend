export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("conversations", "summary", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn("conversations", "summary");
}