export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("chunks", "userId", {
    type: Sequelize.UUID,
    allowNull: false,
  });

  await queryInterface.addConstraint("chunks", {
    fields: ["userId"],
    type: "foreign key",
    name: "fk_chunks_userId",
    references: {
      table: "users",
      field: "userId",
    },
    onDelete: "CASCADE",
  });
}

export async function down(queryInterface) {
  await queryInterface.removeConstraint("chunks", "fk_chunks_userId");
  await queryInterface.removeColumn("chunks", "userId");
}