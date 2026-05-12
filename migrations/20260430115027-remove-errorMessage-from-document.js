export async function up(queryInterface, Sequelize) {
  await queryInterface.removeColumn('documents', 'errorMessage')
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.addColumn('documents', 'errorMessage', {
    type: Sequelize.TEXT,
    allowNull: true
  })
}