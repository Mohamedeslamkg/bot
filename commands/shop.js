const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Interacts with the local merchant.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Lists items available for sale by the local merchant.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('buy')
                .setDescription('Buys an item from the merchant.')
                .addStringOption(option =>
                    option.setName('item_name')
                        .setDescription('The exact name of the item you want to buy.')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('quantity')
                        .setDescription('The quantity of the item you want to buy (default: 1).')
                        .setRequired(false)
                        .setMinValue(1))),

    async execute(interaction) {
        const userId = interaction.user.id;
        const serverId = interaction.guild.id;
        const channelId = interaction.channel.id;
        const subcommand = interaction.options.getSubcommand();

        await interaction.deferReply({ ephemeral: true });

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                console.error('Shop - Error opening database:', err.message);
                interaction.followUp({ content: 'Failed to connect to the game database. Please try again later.', ephemeral: true });
                return;
            }
        });

        // Get current world name
        db.get(`SELECT w.name as world_name 
                FROM worlds w 
                JOIN world_channels wc ON w.world_id = wc.world_id 
                WHERE wc.channel_id = ? AND w.server_id = ?`, 
                [channelId, serverId], (err, worldRow) => {
            if (err) {
                console.error('Shop - Error fetching world data:', err.message);
                interaction.followUp({ content: 'Error trying to determine your current location. Please try again.', ephemeral: true });
                db.close();
                return;
            }
            if (!worldRow) {
                interaction.followUp({ content: 'You must be in a world-specific channel (e.g., #Fire-World-Text) to access the shop.', ephemeral: true });
                db.close();
                return;
            }
            const currentWorldName = worldRow.world_name;

            // Find the merchant in the current world (assuming one merchant per world for now)
            db.get(`SELECT * FROM merchants WHERE world_name = ?`, [currentWorldName], (err, merchant) => {
                if (err) {
                    console.error('Shop - Error fetching merchant data:', err.message);
                    interaction.followUp({ content: 'Error finding the local merchant. Please try again.', ephemeral: true });
                    db.close();
                    return;
                }
                if (!merchant) {
                    interaction.followUp({ content: `There doesn't seem to be a merchant in **${currentWorldName}**.`, ephemeral: true });
                    db.close();
                    return;
                }

                if (subcommand === 'list') {
                    db.all(`
                        SELECT i.name, i.description, mi.buy_price, mi.stock_quantity 
                        FROM items i
                        JOIN merchant_items mi ON i.item_id = mi.item_id
                        WHERE mi.merchant_id = ?
                        ORDER BY i.name
                    `, [merchant.merchant_id], async (err, itemsForSale) => {
                        if (err) {
                            console.error('Shop list - Error fetching items:', err.message);
                            await interaction.followUp({ content: `There was an error fetching items from **${merchant.name}**.`, ephemeral: true });
                            db.close();
                            return;
                        }

                        if (itemsForSale.length === 0) {
                            await interaction.followUp({ content: `**${merchant.name}** has nothing for sale at the moment.`, ephemeral: true });
                            db.close();
                            return;
                        }

                        const embeds = [];
                        const components = [];

                        if (itemsForSale.length === 0) {
                            await interaction.followUp({ content: `**${merchant.name}** has nothing for sale at the moment.`, ephemeral: true });
                            db.close();
                            return;
                        }

                        const shopEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle(`🛍️ ${merchant.name}'s Wares in ${currentWorldName}`)
                            .setDescription(merchant.description || 'Welcome to my shop!')
                            .setTimestamp();
                        
                        let itemsDisplayedCount = 0;

                        for (const item of itemsForSale) {
                            if (itemsDisplayedCount >= 5 && components.length >= 5) { // Limit to 5 items with buttons for now
                                shopEmbed.setFooter({ text: "More items available. The list is paginated for clarity or use /shop list again."});
                                break;
                            }
                            
                            let itemInfo = `**Price:** ${item.buy_price} Shadow Coins\n${item.description}`;
                            if (item.stock_quantity !== null) {
                                itemInfo += `\n*Stock: ${item.stock_quantity}*`;
                            }
                            shopEmbed.addFields({ name: item.name, value: itemInfo });

                            if (components.length < 5) { // Discord allows max 5 action rows, and 5 buttons per row.
                                const buyButton = new ButtonBuilder()
                                    .setCustomId(`shop_buy_${item.item_id}_${merchant.merchant_id}`)
                                    .setLabel(`🛒 Buy ${item.name.substring(0, Math.min(item.name.length, 20))}`) // Truncate for button label
                                    .setStyle(ButtonStyle.Primary);
                                 if (item.stock_quantity === 0) { // Disable if out of stock
                                    buyButton.setDisabled(true).setLabel(`🚫 Out of Stock - ${item.name.substring(0, Math.min(item.name.length, 20))}`);
                                 }
                                components.push(new ActionRowBuilder().addComponents(buyButton));
                            }
                            itemsDisplayedCount++;
                        }
                        
                        embeds.push(shopEmbed);

                        await interaction.followUp({ embeds: embeds, components: components, ephemeral: true });
                        db.close();
                    });

                } else if (subcommand === 'buy') { // This subcommand might be deprecated or modified
                    const itemName = interaction.options.getString('item_name');
                    const quantity = interaction.options.getInteger('quantity') || 1;

                    // Get player_id and shadow_coins
                    db.get(`SELECT player_id, shadow_coins, inventory FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, serverId], (err, player) => {
                        if (err || !player) {
                            console.error('Shop buy - Error fetching player data:', err ? err.message : "Player not found");
                            interaction.followUp({ content: 'Could not retrieve your character data. Please create one first.', ephemeral: true });
                            db.close();
                            return;
                        }

                        // Get item details from merchant's stock
                        db.get(`
                            SELECT i.item_id, i.name, i.description, mi.buy_price, mi.stock_quantity 
                            FROM items i
                            JOIN merchant_items mi ON i.item_id = mi.item_id
                            WHERE mi.merchant_id = ? AND i.name = ?
                        `, [merchant.merchant_id, itemName], async (err, itemToBuy) => {
                            if (err) {
                                console.error('Shop buy - Error fetching item to buy:', err.message);
                                await interaction.followUp({ content: 'There was an error finding that item in the shop.', ephemeral: true });
                                db.close();
                                return;
                            }
                            if (!itemToBuy) {
                                await interaction.followUp({ content: `**${merchant.name}** does not sell an item named "${itemName}". Check the spelling or use \`/shop list\`.`, ephemeral: true });
                                db.close();
                                return;
                            }
                            if (itemToBuy.stock_quantity !== null && itemToBuy.stock_quantity < quantity) {
                                await interaction.followUp({ content: `Sorry, **${merchant.name}** only has ${itemToBuy.stock_quantity} of "${itemName}" in stock.`, ephemeral: true });
                                db.close();
                                return;
                            }

                            const totalCost = itemToBuy.buy_price * quantity;
                            if (player.shadow_coins < totalCost) {
                                await interaction.followUp({ content: `You don't have enough Shadow Coins. You need ${totalCost}, but you only have ${player.shadow_coins}.`, ephemeral: true });
                                db.close();
                                return;
                            }

                            // Proceed with purchase
                            const newPlayerCoins = player.shadow_coins - totalCost;
                            let playerInventory;
                            try {
                                playerInventory = JSON.parse(player.inventory || '[]');
                            } catch (parseError) {
                                console.error('Shop buy - Error parsing player inventory:', parseError);
                                await interaction.followUp({ content: 'There was an error accessing your inventory. The purchase cannot be completed.', ephemeral: true });
                                db.close();
                                return;
                            }

                            const existingItemIndex = playerInventory.findIndex(invItem => invItem.item_name === itemToBuy.name);
                            if (existingItemIndex > -1) {
                                playerInventory[existingItemIndex].quantity += quantity;
                            } else {
                                playerInventory.push({ item_name: itemToBuy.name, quantity: quantity });
                            }
                            const newInventoryJson = JSON.stringify(playerInventory);

                            // Use a transaction for atomic updates
                            db.run('BEGIN TRANSACTION', async (beginErr) => {
                                if (beginErr) {
                                    console.error('Shop buy (subcommand) - BEGIN TRANSACTION error:', beginErr.message);
                                    await interaction.followUp({ content: 'A database error occurred. Please try again.', ephemeral: true });
                                    db.close();
                                    return;
                                }
                                // ... (rest of the buy logic from your original subcommand) ...
                                // For brevity, I'm not copying the entire logic here but it should be the same as before.
                                // Ensure db.close() is called in all paths of this subcommand logic.
                                // This is just a placeholder to show where it would go.
                                 db.run(`UPDATE players SET shadow_coins = ?, inventory = ? WHERE player_id = ?`, 
                                       [newPlayerCoins, newInventoryJson, player.player_id], async function(playerUpdateErr) {
                                    if (playerUpdateErr) {
                                        console.error('Shop buy (subcommand) - Error updating player data:', playerUpdateErr.message);
                                        db.run('ROLLBACK', () => db.close());
                                        await interaction.followUp({ content: 'Failed to update your data. Purchase rolled back.', ephemeral: true });
                                        return;
                                    }
                                     if (itemToBuy.stock_quantity !== null) {
                                        const newStock = itemToBuy.stock_quantity - quantity;
                                        db.run(`UPDATE merchant_items SET stock_quantity = ? WHERE merchant_id = ? AND item_id = ?`,
                                               [newStock, merchant.merchant_id, itemToBuy.item_id], async function(stockUpdateErr) {
                                            if (stockUpdateErr) {
                                                console.error('Shop buy (subcommand) - Error updating stock:', stockUpdateErr.message);
                                                db.run('ROLLBACK', () => db.close());
                                                await interaction.followUp({ content: 'Failed to update shop stock. Purchase rolled back.', ephemeral: true });
                                                return;
                                            }
                                            db.run('COMMIT', (commitErr) => {
                                                if(commitErr) console.error('Shop buy (subcommand) - COMMIT error:', commitErr.message);
                                                else await interaction.followUp({ content: `(Subcommand) Purchased ${quantity}x ${itemToBuy.name}.`, ephemeral: true });
                                                db.close();
                                            });
                                        });
                                    } else { 
                                        db.run('COMMIT', (commitErr) => {
                                            if(commitErr) console.error('Shop buy (subcommand) - COMMIT error (no stock):', commitErr.message);
                                            else await interaction.followUp({ content: `(Subcommand) Purchased ${quantity}x ${itemToBuy.name}.`, ephemeral: true });
                                            db.close();
                                        });
                                    }
                                });
                            });
                        });
                    });
                }
            });
        });
    },
    
    // Handler for button interactions
    async handleShopButton(interaction) {
        await interaction.deferReply({ ephemeral: true }); // Defer reply for button press

        const customIdParts = interaction.customId.split('_'); // shop_buy_itemId_merchantId
        const action = customIdParts[1];
        const itemId = parseInt(customIdParts[2], 10);
        const merchantId = parseInt(customIdParts[3], 10);
        const quantity = 1; // For now, quantity is 1
        const userId = interaction.user.id;
        const serverId = interaction.guild.id;

        if (action !== 'buy') {
            await interaction.followUp({ content: 'Unknown shop action.', ephemeral: true });
            return;
        }

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, async (dbErr) => {
            if (dbErr) {
                console.error('ShopButton - DB Open Error:', dbErr.message);
                await interaction.followUp({ content: 'Database error. Could not process shop action.', ephemeral: true });
                return;
            }

            try {
                const player = await new Promise((resolve, reject) => {
                    db.get(`SELECT player_id, shadow_coins, inventory FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, serverId], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                if (!player) {
                    await interaction.followUp({ content: 'Could not find your character. Please create one first.', ephemeral: true });
                    db.close(); return;
                }

                const itemToBuy = await new Promise((resolve, reject) => {
                    db.get(`SELECT i.item_id, i.name, i.description, mi.buy_price, mi.stock_quantity 
                            FROM items i JOIN merchant_items mi ON i.item_id = mi.item_id
                            WHERE mi.merchant_id = ? AND i.item_id = ?`, [merchantId, itemId], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                if (!itemToBuy) {
                    await interaction.followUp({ content: 'This item is no longer available or the merchant does not sell it.', ephemeral: true });
                    db.close(); return;
                }

                if (itemToBuy.stock_quantity !== null && itemToBuy.stock_quantity < quantity) {
                    await interaction.followUp({ content: `Sorry, the merchant is out of stock for "${itemToBuy.name}".`, ephemeral: true });
                    db.close(); return;
                }

                const totalCost = itemToBuy.buy_price * quantity;
                if (player.shadow_coins < totalCost) {
                    await interaction.followUp({ content: `You don't have enough Shadow Coins. You need ${totalCost}, but you only have ${player.shadow_coins}.`, ephemeral: true });
                    db.close(); return;
                }

                // --- Transaction Start ---
                await new Promise((resolve, reject) => db.run('BEGIN TRANSACTION', (err) => err ? reject(err) : resolve()));

                const newPlayerCoins = player.shadow_coins - totalCost;
                let playerInventory = JSON.parse(player.inventory || '[]');
                const existingItemIndex = playerInventory.findIndex(invItem => invItem.item_name === itemToBuy.name);
                if (existingItemIndex > -1) {
                    playerInventory[existingItemIndex].quantity += quantity;
                } else {
                    playerInventory.push({ item_name: itemToBuy.name, quantity: quantity });
                }
                const newInventoryJson = JSON.stringify(playerInventory);

                await new Promise((resolve, reject) => {
                    db.run(`UPDATE players SET shadow_coins = ?, inventory = ? WHERE player_id = ?`, 
                           [newPlayerCoins, newInventoryJson, player.player_id], function(err) {
                        if (err) reject(err); else resolve(this);
                    });
                });

                if (itemToBuy.stock_quantity !== null) {
                    const newStock = itemToBuy.stock_quantity - quantity;
                    await new Promise((resolve, reject) => {
                        db.run(`UPDATE merchant_items SET stock_quantity = ? WHERE merchant_id = ? AND item_id = ?`,
                               [newStock, merchantId, itemToBuy.item_id], function(err) {
                            if (err) reject(err); else resolve(this);
                        });
                    });
                }
                
                await new Promise((resolve, reject) => db.run('COMMIT', (err) => err ? reject(err) : resolve()));
                // --- Transaction End ---

                await interaction.followUp({ content: `You successfully purchased **${quantity}x ${itemToBuy.name}** for **${totalCost} Shadow Coins**. Your new balance: ${newPlayerCoins}.`, ephemeral: true });

            } catch (error) {
                console.error('ShopButton - Transaction Error:', error);
                await new Promise((resolve, reject) => db.run('ROLLBACK', (err) => err ? reject(err) : resolve())); // Attempt rollback
                await interaction.followUp({ content: 'An error occurred during the transaction. Purchase has been rolled back.', ephemeral: true });
            } finally {
                db.close((closeErr) => {
                    if (closeErr) console.error('ShopButton - DB Close Error:', closeErr.message);
                });
            }
        });
    }
};
