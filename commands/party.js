const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

// In-memory store for party invitations (simple solution for now)
// { invitedUserId: { partyId: X, inviterPlayerId: Y, inviterDiscordId: Z, expiresAt: timestamp } }
const partyInvitations = new Map();


module.exports = {
    data: new SlashCommandBuilder()
        .setName('party')
        .setDescription('Manages your party in Shadow Realms.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Creates a new party, making you the leader.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('invite')
                .setDescription('Invites a player to your party.')
                .addUserOption(option => option.setName('user').setDescription('The user to invite.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('accept')
                .setDescription('Accepts a pending party invitation from a player.')
                .addUserOption(option => option.setName('leader').setDescription('The party leader who invited you.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('leave')
                .setDescription('Leaves your current party.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('disband')
                .setDescription('Disbands the party (leader only).'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('show')
                .setDescription('Shows information about your current party.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const executorUserId = interaction.user.id;
        const serverId = interaction.guild.id;

        await interaction.deferReply({ ephemeral: true });

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                console.error('Party command - Error opening database:', err.message);
                interaction.followUp({ content: 'Failed to connect to the game database. Please try again later.', ephemeral: true });
                return;
            }
        });

        // Get executor's player_id
        db.get(`SELECT player_id FROM players WHERE discord_user_id = ? AND server_id = ?`, [executorUserId, serverId], (err, executorPlayer) => {
            if (err || !executorPlayer) {
                interaction.followUp({ content: 'You need to create a character first using `/create-character`.', ephemeral: true });
                db.close();
                return;
            }
            const executorPlayerId = executorPlayer.player_id;

            if (subcommand === 'create') {
                // Check if player is already in a party
                db.get(`SELECT party_id FROM party_members WHERE player_id = ?`, [executorPlayerId], (err, existingMember) => {
                    if (err) {
                        console.error("Party create - Error checking existing party:", err.message);
                        interaction.followUp({ content: 'An error occurred. Please try again.', ephemeral: true });
                        db.close();
                        return;
                    }
                    if (existingMember) {
                        interaction.followUp({ content: 'You are already in a party. Leave your current party to create a new one.', ephemeral: true });
                        db.close();
                        return;
                    }

                    // Create new party
                    db.run(`INSERT INTO parties (leader_id, server_id) VALUES (?, ?)`, [executorPlayerId, serverId], function(err) {
                        if (err) {
                            console.error("Party create - Error creating party:", err.message);
                            interaction.followUp({ content: 'Failed to create the party. Please try again.', ephemeral: true });
                            db.close();
                            return;
                        }
                        const newPartyId = this.lastID;

                        // Add leader to party_members
                        db.run(`INSERT INTO party_members (party_id, player_id) VALUES (?, ?)`, [newPartyId, executorPlayerId], (err) => {
                            if (err) {
                                console.error("Party create - Error adding leader to members:", err.message);
                                // Attempt to rollback party creation (optional, or leave party and inform user)
                                db.run(`DELETE FROM parties WHERE party_id = ?`, [newPartyId]);
                                interaction.followUp({ content: 'Failed to finalize party creation. Please try again.', ephemeral: true });
                                db.close();
                                return;
                            }
                            interaction.followUp({ content: `🎉 Party created successfully! You are the leader. Party ID: ${newPartyId}. Use \`/party invite @user\` to invite members.`, ephemeral: true });
                            db.close();
                        });
                    });
                });
            } else if (subcommand === 'invite') {
                const targetUser = interaction.options.getUser('user');
                if (targetUser.id === executorUserId) {
                    interaction.followUp({ content: "You cannot invite yourself to your own party!", ephemeral: true });
                    db.close();
                    return;
                }
                if (targetUser.bot) {
                    interaction.followUp({ content: "You cannot invite bots to your party.", ephemeral: true });
                    db.close();
                    return;
                }

                // 1. Check if executor is a party leader
                db.get(`SELECT party_id, max_members FROM parties WHERE leader_id = ? AND server_id = ?`, [executorPlayerId, serverId], (err, party) => {
                    if (err) {
                        console.error("Party invite - Error fetching party:", err.message);
                        interaction.followUp({ content: 'An error occurred while checking your party status.', ephemeral: true });
                        db.close();
                        return;
                    }
                    if (!party) {
                        interaction.followUp({ content: 'You are not a leader of any party. You must create one first or be the leader to invite.', ephemeral: true });
                        db.close();
                        return;
                    }

                    const partyId = party.party_id;

                    // 2. Check if party is full
                    db.get(`SELECT COUNT(*) as member_count FROM party_members WHERE party_id = ?`, [partyId], (err, row) => {
                        if (err) {
                            console.error("Party invite - Error counting members:", err.message);
                            interaction.followUp({ content: 'An error occurred. Please try again.', ephemeral: true });
                            db.close();
                            return;
                        }
                        if (row.member_count >= party.max_members) {
                            interaction.followUp({ content: 'Your party is already full.', ephemeral: true });
                            db.close();
                            return;
                        }

                        // 3. Check if target user is a player and not already in a party
                        db.get(`SELECT p.player_id, pm.party_id as current_party_id 
                                FROM players p 
                                LEFT JOIN party_members pm ON p.player_id = pm.player_id 
                                WHERE p.discord_user_id = ? AND p.server_id = ?`, 
                                [targetUser.id, serverId], async (err, targetPlayerData) => {
                            if (err) {
                                console.error("Party invite - Error fetching target player data:", err.message);
                                interaction.followUp({ content: 'An error occurred while checking the invited player.', ephemeral: true });
                                db.close();
                                return;
                            }
                            if (!targetPlayerData) {
                                interaction.followUp({ content: `${targetUser.username} has not created a character in this realm yet.`, ephemeral: true });
                                db.close();
                                return;
                            }
                            if (targetPlayerData.current_party_id) {
                                interaction.followUp({ content: `${targetUser.username} is already in another party.`, ephemeral: true });
                                db.close();
                                return;
                            }
                            
                            const targetPlayerId = targetPlayerData.player_id;

                            // Check if target is already in this specific party (e.g. invited by someone else and accepted)
                            if (targetPlayerData.current_party_id === partyId) {
                                interaction.followUp({ content: `${targetUser.username} is already a member of your party.`, ephemeral: true });
                                db.close();
                                return;
                            }


                            // 4. Send invitation
                            const invitationTimeout = 60000 * 5; // 5 minutes
                            const expiresAt = Date.now() + invitationTimeout;
                            
                            partyInvitations.set(targetUser.id, {
                                partyId: partyId,
                                inviterPlayerId: executorPlayerId, // Store inviter's game player_id
                                inviterDiscordId: executorUserId, // Store inviter's Discord ID for the message
                                expiresAt: expiresAt
                            });
                            
                            // Remove invitation after timeout
                            setTimeout(() => {
                                if (partyInvitations.has(targetUser.id) && partyInvitations.get(targetUser.id).partyId === partyId) {
                                    partyInvitations.delete(targetUser.id);
                                    console.log(`Party invitation for ${targetUser.username} from party ${partyId} expired.`);
                                }
                            }, invitationTimeout);

                            const inviteEmbed = new EmbedBuilder()
                                .setColor(0x0099FF)
                                .setTitle('🎉 Party Invitation!')
                                .setDescription(`You have been invited by **${interaction.user.username}** to join their party.`)
                                .setFooter({ text: 'This invitation will expire in 5 minutes.' });

                            const actionRow = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`party_accept_${partyId}_${executorPlayerId}`) // Use inviter's player_id
                                        .setLabel('✅ Accept')
                                        .setStyle(ButtonStyle.Success),
                                    new ButtonBuilder()
                                        .setCustomId(`party_decline_${partyId}_${executorPlayerId}`)
                                        .setLabel('❌ Decline')
                                        .setStyle(ButtonStyle.Danger)
                                );
                            
                            try {
                                await targetUser.send({ embeds: [inviteEmbed], components: [actionRow] });
                                interaction.followUp({ content: `Invitation sent to ${targetUser.username}. They have 5 minutes to accept.`, ephemeral: true });
                            } catch (dmError) {
                                console.error("Party invite - Could not DM user:", dmError);
                                interaction.followUp({ content: `Could not send a DM to ${targetUser.username}. They might have DMs disabled.`, ephemeral: true });
                            }
                            db.close();
                        });
                    });
                });
            } else if (subcommand === 'leave') {
                db.get(`SELECT pm.party_id, p.leader_id 
                        FROM party_members pm 
                        JOIN parties p ON pm.party_id = p.party_id 
                        WHERE pm.player_id = ?`, [executorPlayerId], (err, memberInfo) => {
                    if (err) {
                        console.error("Party leave - Error fetching party info:", err.message);
                        return interaction.followUp({ content: 'An error occurred.', ephemeral: true }).finally(() => db.close());
                    }
                    if (!memberInfo) {
                        return interaction.followUp({ content: 'You are not currently in a party.', ephemeral: true }).finally(() => db.close());
                    }

                    const { party_id, leader_id } = memberInfo;

                    if (executorPlayerId === leader_id) {
                        // Leader is leaving - for now, disband the party
                        db.serialize(() => {
                            db.run("DELETE FROM party_members WHERE party_id = ?", [party_id], (delMemErr) => {
                                if (delMemErr) console.error("Party leave (disband by leader) - Error deleting members:", delMemErr.message);
                                else console.log(`All members removed from party ${party_id} due to leader leaving.`);
                            });
                            db.run("DELETE FROM parties WHERE party_id = ?", [party_id], (delPartyErr) => {
                                if (delPartyErr) console.error("Party leave (disband by leader) - Error deleting party:", delPartyErr.message);
                                else console.log(`Party ${party_id} disbanded due to leader leaving.`);
                            });
                            db.close((closeErr) => {
                                if (closeErr) console.error("DB close error after disband by leader:", closeErr.message);
                                interaction.followUp({ content: 'You were the leader and have left the party. The party has been disbanded.', ephemeral: true });
                                // TODO: Notify other members if any (would require fetching them before deleting)
                            });
                        });
                    } else {
                        // Member is leaving
                        db.run(`DELETE FROM party_members WHERE party_id = ? AND player_id = ?`, [party_id, executorPlayerId], function(err) {
                            if (err) {
                                console.error("Party leave - Error removing member:", err.message);
                                return interaction.followUp({ content: 'Failed to leave the party.', ephemeral: true }).finally(() => db.close());
                            }
                            interaction.followUp({ content: 'You have left the party.', ephemeral: true });
                            // TODO: Notify party leader/members
                            db.close();
                        });
                    }
                });
            } else if (subcommand === 'disband') {
                 db.get(`SELECT party_id FROM parties WHERE leader_id = ? AND server_id = ?`, [executorPlayerId, serverId], (err, party) => {
                    if (err) {
                        console.error("Party disband - Error fetching party:", err.message);
                        return interaction.followUp({ content: 'An error occurred.', ephemeral: true }).finally(() => db.close());
                    }
                    if (!party) {
                        return interaction.followUp({ content: 'You are not the leader of any party, or the party does not exist.', ephemeral: true }).finally(() => db.close());
                    }
                    const partyIdToDisband = party.party_id;
                    db.serialize(() => {
                        // TODO: Notify members before deleting
                        db.run(`DELETE FROM party_members WHERE party_id = ?`, [partyIdToDisband], (e) => { 
                            if(e) console.error("Disband members error:", e.message);
                            else console.log(`All members removed from party ${partyIdToDisband} for disband.`);
                        });
                        db.run(`DELETE FROM parties WHERE party_id = ?`, [partyIdToDisband], (e) => { 
                            if(e) console.error("Disband party error:", e.message);
                            else console.log(`Party ${partyIdToDisband} disbanded.`);
                        });
                        db.close((e) => {
                            if(e) console.error("Disband DB close error:", e.message);
                            interaction.followUp({ content: 'Your party has been disbanded.', ephemeral: true });
                        });
                    });
                 });
            } else if (subcommand === 'show') {
                db.get(`
                    SELECT p.party_id, p.leader_id, pl_leader.name as leader_name, p.max_members
                    FROM party_members pm
                    JOIN parties p ON pm.party_id = p.party_id
                    JOIN players pl_leader ON p.leader_id = pl_leader.player_id
                    WHERE pm.player_id = ?
                `, [executorPlayerId], (err, partyInfo) => {
                    if (err) {
                        console.error("Party show - Error fetching party info:", err.message);
                        return interaction.followUp({ content: 'An error occurred.', ephemeral: true }).finally(() => db.close());
                    }
                    if (!partyInfo) {
                        return interaction.followUp({ content: 'You are not currently in a party.', ephemeral: true }).finally(() => db.close());
                    }

                    db.all(`
                        SELECT pl.name, pm.player_id
                        FROM party_members pm
                        JOIN players pl ON pm.player_id = pl.player_id
                        WHERE pm.party_id = ?
                        ORDER BY (pm.player_id = ?) DESC, pl.name ASC 
                    `, [partyInfo.party_id, partyInfo.leader_id], (err, members) => {
                        if (err) {
                            console.error("Party show - Error fetching members:", err.message);
                            return interaction.followUp({ content: 'An error occurred while fetching party members.', ephemeral: true }).finally(() => db.close());
                        }

                        const partyEmbed = new EmbedBuilder()
                            .setColor(0x3498DB) // Blue color
                            .setTitle(`🎉 Party Information (ID: ${partyInfo.party_id})`)
                            .setTimestamp();
                        
                        let membersString = "";
                        if (members.length > 0) {
                            members.forEach(member => {
                                membersString += `- ${member.name} ${member.player_id === partyInfo.leader_id ? '(👑 Leader)' : ''}\n`;
                            });
                        } else {
                            membersString = "No members found (this shouldn't happen if you're in a party).";
                        }
                        
                        partyEmbed.addFields(
                            { name: `Leader`, value: partyInfo.leader_name },
                            { name: `Members (${members.length}/${partyInfo.max_members})`, value: membersString }
                        );

                        interaction.followUp({ embeds: [partyEmbed], ephemeral: true });
                        db.close();
                    });
                });
            } else {
                interaction.followUp({ content: `Subcommand "${subcommand}" logic not yet implemented.`, ephemeral: true });
                db.close();
            }
        });
    },
    async handlePartyInviteButton(interaction) {
        const customIdParts = interaction.customId.split('_');
        const action = customIdParts[1]; // 'accept' or 'decline'
        const partyId = parseInt(customIdParts[2]);
        const inviterPlayerId = parseInt(customIdParts[3]); // Player ID of the inviter
        const invitedDiscordId = interaction.user.id; // Discord ID of the user who clicked

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, async (dbErr) => {
            if (dbErr) {
                console.error("PartyInviteButton - DB Open Error:", dbErr.message);
                await interaction.update({ content: 'Database error. Could not process invitation.', components: [] }).catch(console.error);
                return;
            }

            try {
                await interaction.deferUpdate(); // Acknowledge the button press

                const invitedPlayer = await new Promise((resolve, reject) => {
                    db.get(`SELECT player_id FROM players WHERE discord_user_id = ? AND server_id = ?`, [invitedDiscordId, interaction.guild.id], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                if (!invitedPlayer) {
                    await interaction.editReply({ content: 'You need to have a character to respond to invites.', components: [] });
                    db.close(); return;
                }
                const invitedPlayerId = invitedPlayer.player_id;

                const invitation = partyInvitations.get(invitedDiscordId);
                if (!invitation || invitation.partyId !== partyId || invitation.inviterPlayerId !== inviterPlayerId || Date.now() > invitation.expiresAt) {
                    await interaction.editReply({ content: 'This party invitation is invalid or has expired.', components: [] });
                    partyInvitations.delete(invitedDiscordId); 
                    db.close(); return;
                }
                
                partyInvitations.delete(invitedDiscordId); 

                if (action === 'accept') {
                    const existingParty = await new Promise((resolve, reject) => {
                        db.get(`SELECT party_id FROM party_members WHERE player_id = ?`, [invitedPlayerId], (err, row) => {
                            if (err) reject(err); else resolve(row);
                        });
                    });
                    if (existingParty) {
                        await interaction.editReply({ content: 'You are already in a party. Leave your current party to accept this invitation.', components: [] });
                        db.close(); return;
                    }

                    const partyDetails = await new Promise((resolve, reject) => {
                         db.get(`SELECT max_members, leader_id FROM parties WHERE party_id = ?`, [partyId], (err, row) => {
                            if(err) reject(err); else resolve(row);
                         });
                    });
                     if (!partyDetails) {
                        await interaction.editReply({ content: 'The party no longer exists.', components: [] });
                        db.close(); return;
                    }

                    const memberCount = await new Promise((resolve, reject) => {
                        db.get(`SELECT COUNT(*) as count FROM party_members WHERE party_id = ?`, [partyId], (err, row) => {
                            if(err) reject(err); else resolve(row.count);
                        });
                    });

                    if (memberCount >= partyDetails.max_members) {
                        await interaction.editReply({ content: 'This party is now full.', components: [] });
                        db.close(); return;
                    }

                    await new Promise((resolve, reject) => {
                        db.run(`INSERT INTO party_members (party_id, player_id) VALUES (?, ?)`, [partyId, invitedPlayerId], function(err) {
                            if (err) reject(err); else resolve(this);
                        });
                    });
                    
                    await interaction.editReply({ content: `✅ You have successfully joined the party! (ID: ${partyId})`, components: [] });
                    
                    const inviterDiscordUser = await interaction.client.users.fetch(invitation.inviterDiscordId).catch(() => null);
                    if (inviterDiscordUser) {
                        inviterDiscordUser.send(`${interaction.user.username} has accepted your party invitation!`).catch(console.error);
                    }

                } else if (action === 'decline') {
                    await interaction.editReply({ content: '❌ You have declined the party invitation.', components: [] });
                     const inviterDiscordUser = await interaction.client.users.fetch(invitation.inviterDiscordId).catch(() => null);
                    if (inviterDiscordUser) {
                        inviterDiscordUser.send(`${interaction.user.username} has declined your party invitation.`).catch(console.error);
                    }
                }
            } catch (e) {
                console.error("PartyInviteButton - Error processing invitation response:", e);
                if (!interaction.replied) { 
                     try {await interaction.editReply({ content: 'An error occurred while processing the invitation response.', components: [] });}
                     catch(editErr){console.error("PartyInviteButton - Failed to editReply on error:", editErr)}
                }
            } finally {
                if (db) db.close();
            }
        });
    }
};
