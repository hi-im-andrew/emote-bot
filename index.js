require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { fetchEmoteImage } = require('./emote');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('emote')
    .setDescription('Manage server emotes')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a 7TV emote to this server')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Name for the emote').setRequired(true))
        .addStringOption(opt =>
          opt.setName('link').setDescription('7TV emote URL').setRequired(true))
        .addBooleanOption(opt =>
          opt.setName('animated').setDescription('Upload as animated emote (auto-detected if omitted)').setRequired(false))
    )
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'emote') return;

  const sub = interaction.options.getSubcommand();
  if (sub !== 'add') return;

  const name = interaction.options.getString('name');
  const link = interaction.options.getString('link');
  // null means auto-detect; true/false means the user explicitly chose
  const animatedOverride = interaction.options.getBoolean('animated');

  await interaction.deferReply();

  try {
    const { buffer, animated } = await fetchEmoteImage(link, animatedOverride);

    await interaction.guild.emojis.create({
      attachment: buffer,
      name,
    });

    const tag = animated ? '(animated) ' : '';
    await interaction.editReply(`✅ Emote ${tag}**:${name}:** added successfully!`);
  } catch (err) {
    console.error(err);
    await interaction.editReply(`❌ Failed to add emote: ${err.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
