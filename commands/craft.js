const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('craft')
        .setDescription('Craft items from learned recipes.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Lists recipes you can potentially craft.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('item')
                .setDescription('Attempts to craft a specific item.')
                .addStringOption(option =>
                    option.setName('recipe_name') // Or item_name if recipes are named after output
                        .setDescription('The name of the item/recipe you want to craft.')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('quantity')
                        .setDescription('Number of items to craft (default: 1).')
                        .setRequired(false)
                        .setMinValue(1))),

    async execute(interaction) {
        const userId = interaction.user.id;
        const serverId = interaction.guild.id;
        const subcommand = interaction.options.getSubcommand();

        await interaction.deferReply({ ephemeral: true });

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                console.error('Craft - Error opening database:', err.message);
                interaction.followUp({ content: 'Failed to connect to the game database. Please try again later.', ephemeral: true });
                return;
            }
        });

        // Get Player ID and Inventory
        db.get(`SELECT player_id, inventory FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, serverId], (err, player) => {
            if (err || !player) {
                interaction.followUp({ content: 'You need to create a character first using `/create-character`.', ephemeral: true });
                db.close();
                return;
            }
            const playerId = player.player_id;
            let playerInventory;
            try {
                playerInventory = JSON.parse(player.inventory || '[]');
            } catch (parseError) {
                console.error('Craft list - Error parsing player inventory:', parseError);
                interaction.followUp({ content: 'Could not read your inventory data.', ephemeral: true });
                db.close();
                return;
            }

            if (subcommand === 'list') {
                // Fetch all recipes that are unlocked by default (or player specific unlocks if implemented)
                // For now, only is_unlocked_by_default = TRUE
                db.all(`
                    SELECT r.recipe_id, r.output_item_id, r.output_item_quantity, r.required_ingredients, 
                           r.crafting_station_requirement, r.skill_requirement_name, r.skill_requirement_level,
                           i.name as output_item_name, i.description as output_item_description
                    FROM recipes r
                    JOIN items i ON r.output_item_id = i.item_id 
                    WHERE r.is_unlocked_by_default = TRUE 
                    ORDER BY i.name
                `, [], async (err, recipes) => {
                    if (err) {
                        console.error('Craft list - Error fetching recipes:', err.message);
                        await interaction.followUp({ content: 'There was an error fetching recipes.', ephemeral: true });
                        db.close();
                        return;
                    }

                    if (recipes.length === 0) {
                        await interaction.followUp({ content: 'There are no craftable recipes available at the moment.', ephemeral: true });
                        db.close();
                        return;
                    }

                    const listEmbed = new EmbedBuilder()
                        .setColor(0x職人技) // A crafting-related color
                        .setTitle('🛠️ Craftable Recipes')
                        .setDescription('Here are recipes you might be able to craft. Check your ingredients!')
                        .setTimestamp();
                    
                    const components = []; // For buttons
                    let fieldsAdded = 0;

                    for (const recipe of recipes) {
                        if (fieldsAdded >= 5 && components.length >= 5) break; // Limit display for now

                        let requiredIngredients;
                        try {
                            requiredIngredients = JSON.parse(recipe.required_ingredients);
                        } catch (e) {
                            console.error(`Error parsing ingredients for recipe ${recipe.recipe_id}: ${e.message}`);
                            continue; // Skip this recipe
                        }

                        let ingredientsString = "";
                        let canCraft = true;

                        for (const ing of requiredIngredients) {
                            // We need item names for ingredients, requires another DB lookup or joining in the main query
                            // For simplicity here, we'll assume we can get item names if we adjust the query later
                            // Or, store item_name alongside item_id in the JSON for recipes.
                            // Let's assume we have ingredient item names for now for display purposes.
                            // This part needs item names for required_ingredients.
                            // A quick fix: query item name for each ingredient. Not efficient.
                            const ingredientItemDetails = await new Promise((resolve, reject) => {
                                db.get("SELECT name FROM items WHERE item_id = ?", [ing.item_id], (itemErr, itemRow) => {
                                    if (itemErr) reject(itemErr); else resolve(itemRow);
                                });
                            });
                            const ingredientName = ingredientItemDetails ? ingredientItemDetails.name : `Item ID ${ing.item_id}`;
                            
                            const playerHas = playerInventory.find(pInvItem => pInvItem.item_name === ingredientName); // This assumes item_name is in playerInventory
                            const playerQty = playerHas ? playerHas.quantity : 0;
                            
                            ingredientsString += `${ingredientName} x${ing.quantity} (You have: ${playerQty}) ${playerQty >= ing.quantity ? '✅' : '❌'}\n`;
                            if (playerQty < ing.quantity) {
                                canCraft = false;
                            }
                        }
                        
                        let recipeDescription = `**Ingredients:**\n${ingredientsString}`;
                        if (recipe.crafting_station_requirement) {
                            recipeDescription += `\n**Station:** ${recipe.crafting_station_requirement}`;
                        }
                        if (recipe.skill_requirement_name) {
                            recipeDescription += `\n**Skill:** ${recipe.skill_requirement_name} (Lvl ${recipe.skill_requirement_level})`;
                        }

                        if (fieldsAdded < 25) {
                             listEmbed.addFields({ name: `📜 ${recipe.output_item_name} (x${recipe.output_item_quantity})`, value: recipeDescription });
                             fieldsAdded++;
                        }

                        if (canCraft && components.length < 5) {
                            const craftButton = new ButtonBuilder()
                                .setCustomId(`craft_item_${recipe.recipe_id}`)
                                .setLabel(`🛠️ Craft ${recipe.output_item_name.substring(0,30)}`)
                                .setStyle(ButtonStyle.Success);
                            components.push(new ActionRowBuilder().addComponents(craftButton));
                        }
                    }
                    
                    if (recipes.length > fieldsAdded || recipes.length > components.length && components.length === 5) {
                        listEmbed.setFooter({text: `Showing a portion of recipes. More may be available.`});
                    }
                    if (listEmbed.data.fields && listEmbed.data.fields.length === 0){
                        listEmbed.setDescription("No recipes found or an error occurred displaying them.");
                    }


                    await interaction.followUp({ embeds: [listEmbed], components: components, ephemeral: true });
                    db.close();
                });

            } else if (subcommand === 'item') {
                const recipeNameToCraft = interaction.options.getString('recipe_name');
                const recipeNameToCraft = interaction.options.getString('recipe_name');
                const quantityToCraft = interaction.options.getInteger('quantity') || 1;
                
                // Find recipe by output item name
                db.get(`
                    SELECT r.recipe_id 
                    FROM recipes r 
                    LEFT JOIN items i ON r.output_item_id = i.item_id
                    WHERE COALESCE(i.name, r.output_item_name_temp) = ? AND r.is_unlocked_by_default = TRUE 
                `, [recipeNameToCraft], async (err, recipeRow) => {
                    if (err) {
                        console.error("Craft item subcommand - DB error finding recipe:", err.message);
                        await interaction.followUp({ content: 'Error finding that recipe.', ephemeral: true });
                        db.close();
                        return;
                    }
                    if (!recipeRow) {
                        await interaction.followUp({ content: `Recipe to craft "${recipeNameToCraft}" not found or not available.`, ephemeral: true });
                        db.close();
                        return;
                    }
                    await processCrafting(interaction, playerId, recipeRow.recipe_id, quantityToCraft, db, playerInventory);
                    // db.close() is handled by processCrafting
                });
            }
        });
    },

    async handleCraftButton(interaction) {
        // No need to deferReply if processCrafting handles it.
        // await interaction.deferReply({ ephemeral: true }); 
        
        const customIdParts = interaction.customId.split('_'); // craft_item_recipeId_quantity
        const recipeId = parseInt(customIdParts[2], 10);
        const quantity = parseInt(customIdParts[3], 10) || 1; // Default to 1 if quantity not in customId
        const userId = interaction.user.id;
        const serverId = interaction.guild.id;

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, async (dbErr) => {
            if (dbErr) {
                console.error('CraftButton - DB Open Error:', dbErr.message);
                // Attempt to reply to interaction if possible
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'Database error processing craft action.', ephemeral: true }).catch(e => console.error("Reply error:", e));
                } else if(interaction.deferred) {
                     await interaction.followUp({ content: 'Database error processing craft action.', ephemeral: true }).catch(e => console.error("FollowUp error:", e));
                }
                return;
            }

            try {
                const player = await new Promise((resolve, reject) => {
                    db.get(`SELECT player_id, inventory FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, serverId], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                if (!player) {
                    await interaction.followUp({ content: 'Could not find your character.', ephemeral: true });
                    db.close(); return;
                }
                const playerId = player.player_id;
                let playerInventory;
                try {
                    playerInventory = JSON.parse(player.inventory || '[]');
                } catch (parseError) {
                     await interaction.followUp({ content: 'Error reading your inventory.', ephemeral: true });
                     db.close(); return;
                }
                
                await processCrafting(interaction, playerId, recipeId, quantity, db, playerInventory);
            
            } catch (error) {
                console.error('CraftButton - Handler Error:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'An error occurred processing the craft action.', ephemeral: true}).catch(e => console.error("Reply error:", e));
                } else {
                    await interaction.followUp({ content: 'An error occurred processing the craft action.', ephemeral: true }).catch(e => console.error("FollowUp error:", e));
                }
                if(db) db.close(); // Ensure db is closed on error
            }
            // db.close() is handled by processCrafting or in error catch
        });
    }
};

async function processCrafting(interaction, playerId, recipeId, quantityToCraft, db, playerInventory) {
    try {
        // 1. Fetch Recipe Details
        const recipe = await new Promise((resolve, reject) => {
            db.get(`SELECT r.*, COALESCE(i.name, r.output_item_name_temp) as output_item_name 
                    FROM recipes r 
                    LEFT JOIN items i ON r.output_item_id = i.item_id 
                    WHERE r.recipe_id = ?`, [recipeId], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        if (!recipe) {
            await interaction.followUp({ content: 'Recipe not found.', ephemeral: true });
            db.close(); return;
        }

        // (Future: Check crafting station and skill requirements here)

        // 2. Check Ingredients
        let requiredIngredients;
        try {
            requiredIngredients = JSON.parse(recipe.required_ingredients);
        } catch (e) {
            await interaction.followUp({ content: 'Error reading recipe ingredients.', ephemeral: true });
            db.close(); return;
        }

        let missingIngredients = [];
        for (const ing of requiredIngredients) {
            const ingDetails = await new Promise((resolve, reject) => { // Get name for messages
                 db.get("SELECT name FROM items WHERE item_id = ?", [ing.item_id], (err, row) => err ? reject(err) : resolve(row));
            });
            const ingName = ingDetails ? ingDetails.name : `Item ID ${ing.item_id}`;

            const playerHas = playerInventory.find(pInvItem => pInvItem.item_id === ing.item_id || pInvItem.item_name === ingName); // Check by ID first, then name as fallback
            const playerQty = playerHas ? playerHas.quantity : 0;
            if (playerQty < (ing.quantity * quantityToCraft)) {
                missingIngredients.push(`${ingName} x${(ing.quantity * quantityToCraft) - playerQty} more`);
            }
        }

        if (missingIngredients.length > 0) {
            await interaction.followUp({ content: `You are missing ingredients: ${missingIngredients.join(', ')}.`, ephemeral: true });
            db.close(); return;
        }

        // 3. Perform Crafting (Transaction)
        await new Promise((resolve, reject) => db.run('BEGIN TRANSACTION', err => err ? reject(err) : resolve()));

        // Deduct ingredients
        for (const ing of requiredIngredients) {
             const ingDetails = await new Promise((resolve, reject) => { // Get name for inventory update
                 db.get("SELECT name FROM items WHERE item_id = ?", [ing.item_id], (err, row) => err ? reject(err) : resolve(row));
            });
            const ingName = ingDetails ? ingDetails.name : `Item ID ${ing.item_id}`;

            const itemIndex = playerInventory.findIndex(pInvItem => pInvItem.item_name === ingName);
            playerInventory[itemIndex].quantity -= (ing.quantity * quantityToCraft);
            if (playerInventory[itemIndex].quantity <= 0) {
                playerInventory.splice(itemIndex, 1);
            }
        }

        // Add output item(s)
        const outputItemIndex = playerInventory.findIndex(pInvItem => pInvItem.item_name === recipe.output_item_name);
        if (outputItemIndex > -1) {
            playerInventory[outputItemIndex].quantity += (recipe.output_item_quantity * quantityToCraft);
        } else {
            playerInventory.push({ item_name: recipe.output_item_name, quantity: (recipe.output_item_quantity * quantityToCraft) });
        }
        const newInventoryJson = JSON.stringify(playerInventory);

        await new Promise((resolve, reject) => {
            db.run('UPDATE players SET inventory = ? WHERE player_id = ?', [newInventoryJson, playerId], function(err) {
                if (err) reject(err); else resolve(this);
            });
        });

        await new Promise((resolve, reject) => db.run('COMMIT', err => err ? reject(err) : resolve()));

        await interaction.followUp({ content: `Successfully crafted **${quantityToCraft * recipe.output_item_quantity}x ${recipe.output_item_name}**!`, ephemeral: true });

    } catch (error) {
        console.error('Error during crafting process:', error);
        await new Promise((resolve, reject) => db.run('ROLLBACK', err => err ? reject(err) : resolve()));
        await interaction.followUp({ content: 'An error occurred while crafting. Your ingredients were not consumed.', ephemeral: true });
    } finally {
        if (db) db.close();
    }
}
