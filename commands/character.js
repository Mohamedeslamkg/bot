const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('character')
        .setDescription('Displays information about your character in the Shadow Realms.'),
    async execute(interaction) {
        const discordUserId = interaction.user.id;
        const serverId = interaction.guild.id;

        await interaction.deferReply({ ephemeral: true });

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
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

                // 2. Retrieve player data
                const query = `SELECT name, race, class, gender, level, xp, hp, mp, strength, intelligence, speed, inventory, shadow_coins 
                               FROM players 
                               WHERE discord_user_id = ? AND server_id = ?`;
                
                db.get(query, [discordUserId, serverId], (err, playerRow) => {
                    if (err) {
                        console.error('Error retrieving character data:', err.message);
                        interaction.followUp({ content: 'There was an error retrieving your character information. Please try again.', ephemeral: true });
                        db.close();
                        return;
                    }

                    if (!playerRow) {
                        interaction.followUp({ content: 'You do not have a character in this server yet. Use the `/create-character` command to create one.', ephemeral: true });
                        db.close();
                        return;
                    }

                    // 3. Display character information
                    const inventoryItems = JSON.parse(playerRow.inventory);
                    const inventoryDisplay = inventoryItems.length > 0 ? inventoryItems.join(', ') : 'Empty';

                    const characterEmbed = new EmbedBuilder()
                        .setColor(0x0099FF) // You can choose any color
                        .setTitle(`📜 ${playerRow.name}'s Character Sheet`)
                        .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL({ dynamic: true })})
                        .addFields(
                            { name: 'Race', value: playerRow.race, inline: true },
                            { name: 'Class', value: playerRow.class, inline: true },
                            { name: 'Gender', value: playerRow.gender, inline: true },
                            { name: 'Level', value: `🌟 ${playerRow.level}`, inline: true }
                        );

                    // Fetch XP requirement for the next level
                    db.get(`SELECT xp_required FROM level_xp_requirements WHERE level = ?`, [playerRow.level], (xpErr, xpRow) => {
                        if (xpErr) {
                            console.error("Character - Error fetching next level XP:", xpErr.message);
                            // Continue without next level XP if error
                        }
                        const nextLevelXp = xpRow ? xpRow.xp_required : 'N/A';
                        characterEmbed.addFields({ name: 'XP', value: `✨ ${playerRow.xp} / ${nextLevelXp}`, inline: true });
                        
                        // Add other stats
                        characterEmbed.addFields(
                            { name: 'Shadow Coins', value: `💰 ${playerRow.shadow_coins}`, inline: true },
                            // Assuming HP and MP displayed are current/max as per current system
                            { name: 'HP', value: `❤️ ${playerRow.hp}`, inline: true }, 
                            { name: 'MP', value: `💧 ${playerRow.mp || 0}`, inline: true }, // Default MP to 0 if null/undefined
                            { name: '\u200B', value: '\u200B' }, // Empty field for spacing
                            { name: 'Strength', value: `💪 ${playerRow.strength || 0}`, inline: true },
                            { name: 'Defense', value: `🛡️ ${playerRow.defense || 0}`, inline: true } 
                        );
                        // Add intelligence and speed if they exist, defaulting to 0
                        if (playerRow.hasOwnProperty('intelligence')) {
                            characterEmbed.addFields({ name: 'Intelligence', value: `🧠 ${playerRow.intelligence}`, inline: true });
                        } else {
                             characterEmbed.addFields({ name: 'Intelligence', value: `🧠 0`, inline: true });
                        }
                        if (playerRow.hasOwnProperty('speed')) {
                            characterEmbed.addFields({ name: 'Speed', value: `🏃 ${playerRow.speed}`, inline: true });
                        } else {
                            characterEmbed.addFields({ name: 'Speed', value: `🏃 0`, inline: true });
                        }
                        
                        characterEmbed.addFields({ name: 'Inventory', value: `🎒 ${inventoryDisplay}` });
                        characterEmbed.setTimestamp();
                        characterEmbed.setFooter({ text: 'Shadow Realms RPG' });
                    
                        interaction.followUp({ embeds: [characterEmbed], ephemeral: true });
                        db.close(); // Close DB after all operations for this command
                    });
                });
            });
        });
    },
};
                        .setFooter({ text: 'Shadow Realms RPG' });
                    
// Note: The original db.close() was inside the playerRow check. 
// It should be called only after all DB operations for the command are done.
// The modified code moves db.close() into the final callback for fetching next level XP.
