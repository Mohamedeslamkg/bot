const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Uses an item from your inventory.')
        .addStringOption(option =>
            option.setName('item_name')
                .setDescription('The name of the item you want to use.')
                .setRequired(true)),
    async execute(interaction) {
        const userId = interaction.user.id;
        const serverId = interaction.guild.id;
        const itemName = interaction.options.getString('item_name');

        await interaction.deferReply({ ephemeral: true });

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                console.error('UseItem - Error opening database:', err.message);
                interaction.followUp({ content: 'Failed to connect to the game database. Please try again later.', ephemeral: true });
                return;
            }
        });

        db.serialize(() => {
            // 1. Get Player Data (including inventory and stats)
            db.get(`SELECT player_id, hp, mp, strength, intelligence, speed, inventory, level, class 
                    FROM players 
                    WHERE discord_user_id = ? AND server_id = ?`, 
                    [userId, serverId], async (err, playerData) => {
                if (err || !playerData) {
                    console.error('UseItem - Error fetching player data or player not found:', err ? err.message : 'Player not found');
                    await interaction.followUp({ content: 'Could not retrieve your character data. Please try again.', ephemeral: true });
                    db.close();
                    return;
                }

                let playerInventory;
                try {
                    playerInventory = JSON.parse(playerData.inventory || '[]');
                } catch (parseError) {
                    console.error('UseItem - Error parsing player inventory:', parseError);
                    await interaction.followUp({ content: 'There was an error accessing your inventory. It might be corrupted.', ephemeral: true });
                    db.close();
                    return;
                }

                // 2. Check if item is in inventory
                const itemInInventoryIndex = playerInventory.findIndex(invItem => invItem.item_name.toLowerCase() === itemName.toLowerCase());

                if (itemInInventoryIndex === -1) {
                    await interaction.followUp({ content: `You do not have "${itemName}" in your inventory.`, ephemeral: true });
                    db.close();
                    return;
                }

                // 3. Get item details from 'items' table
                db.get(`SELECT * FROM items WHERE name = ?`, [playerInventory[itemInInventoryIndex].item_name], async (err, itemDetails) => {
                    if (err || !itemDetails) {
                        console.error('UseItem - Error fetching item details or item not found in DB:', err ? err.message : 'Item not found in DB');
                        await interaction.followUp({ content: `Could not find details for "${itemName}". The item might be invalid or removed.`, ephemeral: true });
                        db.close();
                        return;
                    }

                    // 4. Apply item effect
                    let updateQuery = '';
                    let updateParams = [];
                    let successMessage = `You used **${itemDetails.name}**.`;
                    let requiresDbUpdate = true;

                    // For max HP/MP, we might need to calculate it. For now, a simple placeholder.
                    // A more robust system would fetch or calculate max_hp/max_mp based on class/level.
                    const maxHp = (playerData.level * 10) + (playerData.class === 'محارب' ? 100 : 80); // Example calculation
                    const maxMp = (playerData.level * 5) + (playerData.class === 'ساحر' ? 100 : 50);  // Example calculation

                    switch (itemDetails.effect_type) {
                        case 'HEAL_HP':
                            const newHp = Math.min(maxHp, playerData.hp + itemDetails.effect_value);
                            if (newHp === playerData.hp) {
                                successMessage = `You used **${itemDetails.name}**, but your HP is already full!`;
                                requiresDbUpdate = false; // No actual change in HP
                            } else {
                                updateQuery = `UPDATE players SET hp = ? WHERE player_id = ?`;
                                updateParams = [newHp, playerData.player_id];
                                successMessage += ` You recovered **${itemDetails.effect_value} HP**. Your HP is now ${newHp}/${maxHp}.`;
                            }
                            break;
                        case 'HEAL_MP':
                            const newMp = Math.min(maxMp, playerData.mp + itemDetails.effect_value);
                             if (newMp === playerData.mp) {
                                successMessage = `You used **${itemDetails.name}**, but your MP is already full!`;
                                requiresDbUpdate = false;
                            } else {
                                updateQuery = `UPDATE players SET mp = ? WHERE player_id = ?`;
                                updateParams = [newMp, playerData.player_id];
                                successMessage += ` You recovered **${itemDetails.effect_value} MP**. Your MP is now ${newMp}/${maxMp}.`;
                            }
                            break;
                        case 'STAT_BOOST':
                            if (!itemDetails.target_stat || !['hp', 'mp', 'strength', 'intelligence', 'speed', 'defense'].includes(itemDetails.target_stat)) {
                                await interaction.followUp({ content: `Cannot use "${itemDetails.name}": Invalid target stat defined for this item.`, ephemeral: true });
                                db.close();
                                return;
                            }
                            // For HP/MP stat boosts, it should probably increase max_hp/max_mp, which is complex for now.
                            // We'll assume target_stat is one of strength, intelligence, speed, defense for simplicity.
                            // If target_stat is hp or mp, it means max_hp or max_mp, which is not directly handled here yet.
                            // For now, let's assume STAT_BOOST for strength, intelligence, speed, defense affects the direct stat.
                            // And if it's hp/mp, it's like HEAL for now or we can skip it for STAT_BOOST
                            if (itemDetails.target_stat === 'hp' || itemDetails.target_stat === 'mp') {
                                 await interaction.followUp({ content: `Cannot use "${itemDetails.name}": Boosting max HP/MP directly is not yet supported this way. Use healing items instead.`, ephemeral: true });
                                 db.close();
                                 return;
                            }

                            updateQuery = `UPDATE players SET ${itemDetails.target_stat} = ${itemDetails.target_stat} + ? WHERE player_id = ?`;
                            updateParams = [itemDetails.effect_value, playerData.player_id];
                            successMessage += ` Your **${itemDetails.target_stat}** increased by **${itemDetails.effect_value}**!`;
                            break;
                        default:
                            await interaction.followUp({ content: `Cannot use "${itemDetails.name}": Unknown effect type.`, ephemeral: true });
                            db.close();
                            return;
                    }
                    
                    const applyEffectAndUpdateInventory = () => {
                        // 5. Update Inventory (if consumable)
                        if (itemDetails.consumable) {
                            playerInventory[itemInInventoryIndex].quantity -= 1;
                            if (playerInventory[itemInInventoryIndex].quantity <= 0) {
                                playerInventory.splice(itemInInventoryIndex, 1);
                            }
                            const newInventoryJson = JSON.stringify(playerInventory);
                            db.run(`UPDATE players SET inventory = ? WHERE player_id = ?`, [newInventoryJson, playerData.player_id], async (invUpdateErr) => {
                                if (invUpdateErr) {
                                    console.error('UseItem - Error updating player inventory:', invUpdateErr.message);
                                    // Attempt to rollback or notify user of partial success
                                    await interaction.followUp({ content: 'Successfully used the item, but there was an issue updating your inventory. Please check it.', ephemeral: true });
                                } else {
                                    await interaction.followUp({ content: successMessage, ephemeral: true });
                                }
                                db.close();
                            });
                        } else {
                            // Item not consumable, no inventory update needed other than player stats
                             await interaction.followUp({ content: successMessage + " (This item was not consumed).", ephemeral: true });
                             db.close();
                        }
                    };


                    if (requiresDbUpdate && updateQuery) {
                        db.run(updateQuery, updateParams, async function(statUpdateErr) {
                            if (statUpdateErr) {
                                console.error('UseItem - Error applying item effect:', statUpdateErr.message);
                                await interaction.followUp({ content: `Failed to apply the effect of "${itemDetails.name}". Please try again.`, ephemeral: true });
                                db.close();
                                return;
                            }
                            applyEffectAndUpdateInventory();
                        });
                    } else if (!requiresDbUpdate) { // e.g. HP/MP already full
                        // No stat update was needed, but inventory might still need update if consumable
                        // This case is tricky if item is consumable but no effect applied (e.g. HP full potion)
                        // For now, if no stat change, don't consume it either.
                        // A better logic would be: if effect_type is HEAL_HP and HP is full, don't allow use or don't consume.
                        // Current logic: if HP is full, it says "HP is full" and doesn't proceed to consume.
                        await interaction.followUp({ content: successMessage, ephemeral: true });
                        db.close();

                    } else { // No DB update query was prepared (e.g. invalid item type handled before)
                        // This case should ideally be caught earlier.
                        db.close();
                    }
                });
            });
        });
    },
};
