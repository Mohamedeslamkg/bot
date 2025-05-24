const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');
const { activeBattles, getBattleActionRow } = require('./explore.js'); // Assuming explore.js exports activeBattles and getBattleActionRow

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

// Configuration for boss summoning
const BOSS_SUMMON_CONFIG = {
    "Infernos, Lord of the Blazing Peaks": {
        requiredChannelName: "fire-world-text", // Channel where the boss can be summoned
        summonItemName: "Infernal Core",       // Item required to summon
        bossWorldName: "Fire World"            // World where the boss resides (for DB query)
    }
    // Add other bosses here
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('summonboss')
        .setDescription('Attempts to summon a powerful boss using a special item.')
        .addStringOption(option =>
            option.setName('boss_name')
                .setDescription('The name of the boss you want to summon.')
                .setRequired(true)
                // Add choices later if many bosses, or use autocomplete
                .addChoices(
                    { name: 'Infernos, Lord of the Blazing Peaks', value: 'Infernos, Lord of the Blazing Peaks' }
                )),
    
    async execute(interaction) {
        const userId = interaction.user.id;
        const serverId = interaction.guild.id;
        const channelName = interaction.channel.name.toLowerCase(); // For channel check
        const bossNameToSummon = interaction.options.getString('boss_name');

        await interaction.deferReply({ ephemeral: true });

        const summonConfig = BOSS_SUMMON_CONFIG[bossNameToSummon];
        if (!summonConfig) {
            await interaction.followUp({ content: `Configuration for boss "${bossNameToSummon}" not found.`, ephemeral: true });
            return;
        }

        // 1. Check if player is in the correct channel
        if (channelName !== summonConfig.requiredChannelName) {
            await interaction.followUp({ content: `You must be in the #${summonConfig.requiredChannelName} channel to summon ${bossNameToSummon}.`, ephemeral: true });
            return;
        }

        // 2. Check if player is already in a battle
        if (activeBattles[userId]) {
            await interaction.followUp({ content: 'You are already in a battle! You must resolve it first.', ephemeral: true });
            return;
        }
        
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                console.error('SummonBoss - Error opening database:', err.message);
                interaction.followUp({ content: 'Failed to connect to the game database. Please try again later.', ephemeral: true });
                return;
            }
        });

        db.get(`SELECT player_id, inventory FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, serverId], async (err, player) => {
            if (err || !player) {
                await interaction.followUp({ content: 'Could not retrieve your character data. Make sure you have created a character.', ephemeral: true });
                db.close();
                return;
            }
            const playerId = player.player_id;
            let playerInventory;
            try {
                playerInventory = JSON.parse(player.inventory || '[]');
            } catch (parseError) {
                await interaction.followUp({ content: 'Error reading your inventory.', ephemeral: true });
                db.close();
                return;
            }

            // 3. Check if player has the summoning item
            const summonItemIndex = playerInventory.findIndex(item => item.item_name === summonConfig.summonItemName);
            if (summonItemIndex === -1 || playerInventory[summonItemIndex].quantity < 1) {
                await interaction.followUp({ content: `You do not have the required item "${summonConfig.summonItemName}" to summon ${bossNameToSummon}.`, ephemeral: true });
                db.close();
                return;
            }

            // 4. Fetch Boss Data
            db.get(`SELECT * FROM enemies WHERE name = ? AND world_name = ? AND is_boss = TRUE`, 
                   [bossNameToSummon, summonConfig.bossWorldName], async (err, bossData) => {
                if (err || !bossData) {
                    await interaction.followUp({ content: `Boss "${bossNameToSummon}" not found in the database for ${summonConfig.bossWorldName}.`, ephemeral: true });
                    db.close();
                    return;
                }

                // 5. Consume Summoning Item & Start Battle (Transaction for item consumption)
                playerInventory[summonItemIndex].quantity -= 1;
                if (playerInventory[summonItemIndex].quantity <= 0) {
                    playerInventory.splice(summonItemIndex, 1);
                }
                const newInventoryJson = JSON.stringify(playerInventory);

                db.run("BEGIN TRANSACTION", async (beginErr) => {
                    if (beginErr) {
                        console.error("SummonBoss - Begin Transaction Error:", beginErr.message);
                        await interaction.followUp({ content: "Database error, could not start transaction.", ephemeral: true });
                        db.close(); return;
                    }

                    db.run(`UPDATE players SET inventory = ? WHERE player_id = ?`, [newInventoryJson, playerId], async function(updateErr) {
                        if (updateErr) {
                            console.error("SummonBoss - Error consuming item:", updateErr.message);
                            db.run("ROLLBACK");
                            await interaction.followUp({ content: `Failed to use ${summonConfig.summonItemName}. Please try again.`, ephemeral: true });
                            db.close(); return;
                        }

                        db.run("COMMIT", async (commitErr) => {
                            if (commitErr) {
                                console.error("SummonBoss - Commit Transaction Error:", commitErr.message);
                                // Rollback might not be strictly necessary here if only one update failed before commit
                                await interaction.followUp({ content: "Database error, item consumption might be inconsistent.", ephemeral: true });
                                db.close(); return;
                            }

                            // Successfully consumed item, now start battle
                            const initialParticipants = [ { playerId: playerId, discordUserId: userId, name: player.name, hp: player.hp, mp: player.mp, effects: [] } ]; // Start with the summoner

                            db.all(`
                                SELECT pm.player_id, p_player.discord_user_id, p_player.name, p_player.hp, p_player.mp 
                                FROM party_members pm 
                                JOIN players p_player ON pm.player_id = p_player.player_id
                                WHERE pm.party_id = (SELECT party_id FROM party_members WHERE player_id = ?)
                                AND pm.player_id != ? AND p_player.server_id = ?`, 
                                [playerId, playerId, serverId], async (partyErr, partyMembersRows) => {
                                if (partyErr) console.error("Error fetching party members for boss battle:", partyErr.message);
                                
                                if (partyMembersRows && partyMembersRows.length > 0) {
                                    partyMembersRows.forEach(member => {
                                        if(initialParticipants.length < 4) { // Max 4 participants
                                            initialParticipants.push({ 
                                                playerId: member.player_id, 
                                                discordUserId: member.discord_user_id, 
                                                name: member.name,
                                                hp: member.hp, // Store initial HP for battle display
                                                mp: member.mp,  // Store initial MP
                                                effects: []      // Each participant has their own effects
                                            });
                                        }
                                    });
                                }

                                // Create a unique battle ID for this boss encounter
                                const bossBattleId = `boss_${bossData.enemy_id}_${Date.now()}`;
                                activeBattles[bossBattleId] = { // Use bossBattleId as key
                                    enemy_effects: [],
                                    enemy: bossData,
                                    enemy_current_hp: bossData.hp,
                                    worldName: summonConfig.bossWorldName, 
                                    participants: initialParticipants, // Array of participant objects
                                    isBossBattle: true,
                                    turn: 0, // To track turns, boss might have special moves on certain turns
                                    nextParticipantIndex: 0, // To cycle through player turns
                                };
                            
                                let battleMessage = `You have successfully summoned **${bossData.name}** using the ${summonConfig.summonItemName}!`;
                                if (initialParticipants.length > 1) {
                                     battleMessage += `\nParty members involved: ${initialParticipants.map(p=>p.name).join(', ')}.`;
                                }
                                battleMessage += `\nPrepare for a tough fight! It's **${initialParticipants[0].name}**'s turn.`;


                                const summonEmbed = new EmbedBuilder()
                                    .setColor(0xFF0000)
                                    .setTitle(`🔥 ${bossData.name} Appears! 🔥`)
                                    .setDescription(battleMessage)
                                    .setImage(bossData.image_url || null)
                                    .addFields(
                                        { name: 'HP', value: `❤️ ${bossData.hp}`, inline: true },
                                        { name: 'Attack', value: `⚔️ ${bossData.attack}`, inline: true },
                                        { name: 'Defense', value: `🛡️ ${bossData.defense}`, inline: true }
                                    )
                                    .setFooter({ text: 'The air crackles with immense power...' });
                
                                // Call the Boss Battle Manager to start the battle
                                const bossBattleManager = require('../bossBattleManager.js'); // Adjust path if necessary
                                await bossBattleManager.startBossBattle(interaction, bossData, initialParticipants);
                                // db.close() should be handled by startBossBattle or after its completion if not handled within
                                // For now, we assume startBossBattle will handle the interaction response and DB closure.
                                // The followUp here might be redundant if startBossBattle sends its own confirmation.
                                // await interaction.followUp({ content: `${summonConfig.summonItemName} consumed. ${bossData.name} has been summoned!`, ephemeral: true });
                            }); 
                        });
                    });
                });
            });
        });
    },
};

// getBossBattleActionRow is removed from here as it will be part of bossBattleManager.js
// or a shared utility if needed by other modules.
                                .setColor(0xFF0000)
                                .setTitle(`🔥 ${bossData.name} Appears! 🔥`)
                                .setDescription(`You have successfully summoned **${bossData.name}** using the ${summonConfig.summonItemName}! Prepare for a tough fight!`)
                                .setImage(bossData.image_url || null)
                                .addFields(
                                    { name: 'HP', value: `❤️ ${bossData.hp}`, inline: true },
                                    { name: 'Attack', value: `⚔️ ${bossData.attack}`, inline: true },
                                    { name: 'Defense', value: `🛡️ ${bossData.defense}`, inline: true }
                                )
                                .setFooter({ text: 'The air crackles with immense power...' });
            
                            // Announce in current channel (not ephemeral)
                            await interaction.channel.send({ embeds: [summonEmbed], components: [getBattleActionRow()] });
                            // Ephemeral confirmation for the summoner
                            await interaction.followUp({ content: `${summonConfig.summonItemName} consumed. ${bossData.name} has been summoned in this channel!`, ephemeral: true });
                            db.close();
                        });
                    });
                });
            });
        });
    },
};
