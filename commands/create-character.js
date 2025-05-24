const { SlashCommandBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

// Base stats for classes (HP, MP)
const classBaseStats = {
    محارب: { hp: 150, mp: 50 },
    ساحر: { hp: 80, mp: 150 },
    قاتل: { hp: 100, mp: 70 },
    كاهن: { hp: 90, mp: 120 },
    مستدعي: { hp: 100, mp: 100 },
};

// Base attributes for races (strength, intelligence, speed) - can be adjusted
const raceBaseAttributes = {
    بشري: { strength: 10, intelligence: 10, speed: 10 },
    إلف: { strength: 8, intelligence: 12, speed: 11 },
    هومناغين: { strength: 12, intelligence: 8, speed: 9 }, // (Dwarf/Gnome like)
    شيطاني: { strength: 11, intelligence: 11, speed: 10 },
    آلي: { strength: 9, intelligence: 9, speed: 13 },
};


module.exports = {
    data: new SlashCommandBuilder()
        .setName('create-character')
        .setDescription('Creates a new character in the Shadow Realms.')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of your character.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('race')
                .setDescription('The race of your character.')
                .setRequired(true)
                .addChoices(
                    { name: 'بشري (Human)', value: 'بشري' },
                    { name: 'إلف (Elf)', value: 'إلف' },
                    { name: 'هومناغين (Homnaguin/Dwarf-like)', value: 'هومناغين' },
                    { name: 'شيطاني (Demonic)', value: 'شيطاني' },
                    { name: 'آلي (Cyborg/Automaton)', value: 'آلي' }
                ))
        .addStringOption(option =>
            option.setName('class')
                .setDescription('The class of your character.')
                .setRequired(true)
                .addChoices(
                    { name: 'محارب (Warrior)', value: 'محارب' },
                    { name: 'ساحر (Mage)', value: 'ساحر' },
                    { name: 'قاتل (Assassin)', value: 'قاتل' },
                    { name: 'كاهن (Priest)', value: 'كاهن' },
                    { name: 'مستدعي (Summoner)', value: 'مستدعي' }
                ))
        .addStringOption(option =>
            option.setName('gender')
                .setDescription('The gender of your character.')
                .setRequired(true)
                .addChoices(
                    { name: 'ذكر (Male)', value: 'ذكر' },
                    { name: 'أنثى (Female)', value: 'أنثى' },
                    { name: 'آخر (Other)', value: 'آخر' }
                )),
    async execute(interaction) {
        const characterName = interaction.options.getString('name');
        const characterRace = interaction.options.getString('race');
        const characterClass = interaction.options.getString('class');
        const characterGender = interaction.options.getString('gender');
        const discordUserId = interaction.user.id;
        const serverId = interaction.guild.id;

        await interaction.deferReply({ ephemeral: true });

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                interaction.followUp({ content: 'Failed to connect to the game database. Please try again later.', ephemeral: true });
                return;
            }
        });

        db.serialize(() => {
            // 1. Check if the server is initialized
            db.get(`SELECT server_id FROM servers WHERE server_id = ?`, [serverId], (err, serverRow) => {
                if (err) {
                    console.error('Error checking server initialization:', err.message);
                    interaction.followUp({ content: 'There was an error verifying server setup. Please try again.', ephemeral: true });
                    db.close();
                    return;
                }
                if (!serverRow) {
                    interaction.followUp({ content: 'This server has not been initialized for Shadow Realms yet. An administrator must run the `/install` command first.', ephemeral: true });
                    db.close();
                    return;
                }

                // 2. Check if player already has a character
                db.get(`SELECT player_id FROM players WHERE discord_user_id = ? AND server_id = ?`, [discordUserId, serverId], (err, playerRow) => {
                    if (err) {
                        console.error('Error checking for existing character:', err.message);
                        interaction.followUp({ content: 'There was an error checking for an existing character. Please try again.', ephemeral: true });
                        db.close();
                        return;
                    }
                    if (playerRow) {
                        interaction.followUp({ content: 'You already have a character in this server. You cannot create more than one.', ephemeral: true });
                        db.close();
                        return;
                    }

                    // 3. Determine base stats and attributes
                    const baseStats = classBaseStats[characterClass] || { hp: 100, mp: 100 }; 
                    const raceAttrs = raceBaseAttributes[characterRace] || {}; 

                    const finalAttributes = {
                        strength: raceAttrs.strength || 10,
                        intelligence: raceAttrs.intelligence || 10,
                        speed: raceAttrs.speed || 10,
                        defense: raceAttrs.defense || 5 // Default defense if not specified by race
                    };

                    // 4. Insert new character data
                    const insertQuery = `INSERT INTO players 
                                        (discord_user_id, server_id, name, race, class, gender, level, xp, hp, mp, strength, intelligence, speed, defense, inventory, shadow_coins) 
                                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    const params = [
                        discordUserId,
                        serverId,
                        characterName,
                        characterRace,
                        characterClass,
                        characterGender,
                        1, // level
                        0, // xp
                        baseStats.hp,
                        baseStats.mp,
                        finalAttributes.strength,
                        finalAttributes.intelligence,
                        finalAttributes.speed,
                        finalAttributes.defense,
                        JSON.stringify([]), // inventory (empty array)
                        50 // shadow_coins
                    ];

                    db.run(insertQuery, params, function(err) {
                        if (err) {
                            console.error('Error creating character:', err.message);
                            interaction.followUp({ content: 'There was an error creating your character. Please try again.', ephemeral: true });
                            db.close();
                            return;
                        }
                        interaction.followUp({ 
                            content: `Congratulations, ${characterName}! Your character has been created.\n` +
                                     `**Race:** ${characterRace}\n` +
                                     `**Class:** ${characterClass}\n` +
                                     `**Gender:** ${characterGender}\n` +
                                     `Welcome to the Shadow Realms!`,
                            ephemeral: true 
                        });
                        db.close();
                    });
                });
            });
        });
    },
};
