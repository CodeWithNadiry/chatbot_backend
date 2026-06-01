import { v4 as uuidv4 } from 'uuid';

export async function up(queryInterface, Sequelize) {
  await queryInterface.bulkInsert('tools', [
    {
      toolId: uuidv4(),
      name: 'send_email',
      provider: 'google',

      description: 'Send email using connected Gmail account',

      parameters: JSON.stringify({
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          message: { type: 'string' }
        },
        required: ['to', 'subject', 'message']
      }),

      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]);
}

export async function down(queryInterface) {
  await queryInterface.bulkDelete('tools', {
    name: 'send_email'
  });
}