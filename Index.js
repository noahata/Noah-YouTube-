‎const { Telegraf } = require('telegraf');
‎const { google } = require('googleapis');
‎const fs = require('fs');
‎const path = require('path');
‎
‎// ========== CONFIGURATION ==========
‎const BOT_TOKEN = process.env.BOT_TOKEN;
‎const ADMIN_ID = parseInt(process.env.ADMIN_ID) || null;
‎const DATA_FILE = path.join(__dirname, 'userdata.json');
‎// ===================================
‎
‎// User data storage
‎let userData = {};
‎
‎// Load user data
‎if (fs.existsSync(DATA_FILE)) {
‎    try {
‎        userData = JSON.parse(fs.readFileSync(DATA_FILE));
‎        console.log(`📂 Loaded data for ${Object.keys(userData).length} users`);
‎    } catch (e) {
‎        console.log('⚠️ Error loading data, starting fresh');
‎        userData = {};
‎    }
‎}
‎
‎// Save user data
‎function saveUserData() {
‎    try {
‎        fs.writeFileSync(DATA_FILE, JSON.stringify(userData, null, 2));
‎        console.log('💾 User data saved');
‎    } catch (e) {
‎        console.error('❌ Error saving data:', e.message);
‎    }
‎}
‎
‎// Initialize user data
‎function initUser(userId, username = null, firstName = null) {
‎    if (!userData[userId]) {
‎        userData[userId] = {
‎            userId: userId,
‎            username: username,
‎            firstName: firstName,
‎            joinedAt: new Date().toISOString(),
‎            lastActive: new Date().toISOString(),
‎            settings: {
‎                yourChannelId: null,
‎                privateChannelId: null,
‎                youtubeApiKey: null,
‎                monitorInterval: 60,
‎                postDelay: 60,
‎                isMonitoring: false,
‎                defaultDescription: null,
‎                autoAddVideos: true
‎            },
‎            videoSupply: [],
‎            monitoredChannels: [],
‎            lastVideoIds: {},
‎            lastPostDate: null,
‎            dailyPosts: 0,
‎            dailyLimit: null,
‎            totalPosts: 0,
‎            lastPostTime: null,
‎            lastProcessedMessageId: null
‎        };
‎        saveUserData();
‎        console.log(`👤 New user: ${userId} (${username || 'no username'}) - Total: ${Object.keys(userData).length}`);
‎    } else {
‎        userData[userId].lastActive = new Date().toISOString();
‎        if (username) userData[userId].username = username;
‎        if (firstName) userData[userId].firstName = firstName;
‎        saveUserData();
‎    }
‎    return userData[userId];
‎}
‎
‎// Get user stats
‎function getUserStats() {
‎    const totalUsers = Object.keys(userData).length;
‎    let activeUsers = 0, totalMonitoredChannels = 0, totalVideosInSupply = 0, totalPostsAllTime = 0;
‎    for (const userId in userData) {
‎        const user = userData[userId];
‎        if (user.settings.isMonitoring) activeUsers++;
‎        totalMonitoredChannels += user.monitoredChannels.length;
‎        totalVideosInSupply += user.videoSupply.length;
‎        totalPostsAllTime += user.totalPosts || 0;
‎    }
‎    return { totalUsers, activeUsers, totalMonitoredChannels, totalVideosInSupply, totalPostsAllTime };
‎}
‎
‎function getUserYoutubeClient(apiKey) {
‎    return google.youtube({ version: 'v3', auth: apiKey });
‎}
‎
‎function parseDuration(duration) {
‎    const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
‎    const minutes = parseInt(match[1]) || 0;
‎    const seconds = parseInt(match[2]) || 0;
‎    return minutes * 60 + seconds;
‎}
‎
‎function getNextVideo(userId) {
‎    const user = userData[userId];
‎    if (!user || user.videoSupply.length === 0) return null;
‎    return user.videoSupply.shift();
‎}
‎
‎async function postYourVideo(bot, userId, channelId, videoTitle) {
‎    const user = userData[userId];
‎    if (!user) return false;
‎    
‎    if (user.videoSupply.length === 0) {
‎        if (user.settings.yourChannelId) {
‎            await bot.telegram.sendMessage(user.settings.yourChannelId, `⚠️ Video supply empty! Upload videos to your private channel.`);
‎        }
‎        return false;
‎    }
‎    if (!user.settings.yourChannelId || !user.settings.privateChannelId) return false;
‎    
‎    const nextVideo = getNextVideo(userId);
‎    if (!nextVideo) return false;
‎    
‎    let caption = '';
‎    
‎    if (nextVideo.description) {
‎        caption = nextVideo.description;
‎    } else if (user.settings.defaultDescription) {
‎        caption = user.settings.defaultDescription;
‎    }
‎    
‎    caption = caption
‎        .replace(/{channel}/g, channelId || 'Unknown')
‎        .replace(/{title}/g, videoTitle || 'YouTube Short')
‎        .replace(/{date}/g, new Date().toLocaleDateString())
‎        .replace(/{time}/g, new Date().toLocaleTimeString())
‎        .replace(/{user}/g, user.username || 'User');
‎    
‎    try {
‎        if (caption) {
‎            await bot.telegram.copyMessage(
‎                user.settings.yourChannelId,
‎                user.settings.privateChannelId,
‎                nextVideo.messageId,
‎                { caption: caption, parse_mode: 'HTML' }
‎            );
‎        } else {
‎            await bot.telegram.copyMessage(
‎                user.settings.yourChannelId,
‎                user.settings.privateChannelId,
‎                nextVideo.messageId
‎            );
‎        }
‎        
‎        user.dailyPosts++;
‎        user.totalPosts = (user.totalPosts || 0) + 1;
‎        user.lastPostTime = new Date().toISOString();
‎        const remaining = user.videoSupply.length;
‎        console.log(`User ${userId}: Posted! Remaining: ${remaining}`);
‎        
‎        if (remaining === 3 && user.settings.yourChannelId) {
‎            await bot.telegram.sendMessage(user.settings.yourChannelId, `⚠️ Low supply! Only ${remaining} videos left. Upload more to your private channel.`);
‎        }
‎        saveUserData();
‎        return true;
‎    } catch (error) {
‎        console.error(`User ${userId}: Post failed:`, error.message);
‎        user.videoSupply.unshift(nextVideo);
‎        return false;
‎    }
‎}
‎
‎async function checkChannel(bot, userId, channelId) {
‎    const user = userData[userId];
‎    if (!user || !user.settings.youtubeApiKey) return;
‎    
‎    const youtube = getUserYoutubeClient(user.settings.youtubeApiKey);
‎    try {
‎        const channelRes = await youtube.channels.list({ part: 'contentDetails', id: channelId });
‎        if (!channelRes.data.items.length) return;
‎        const playlistId = channelRes.data.items[0].contentDetails.relatedPlaylists.uploads;
‎        const playlistRes = await youtube.playlistItems.list({ part: 'snippet', playlistId, maxResults: 1 });
‎        if (!playlistRes.data.items.length) return;
‎        
‎        const latest = playlistRes.data.items[0];
‎        const videoId = latest.snippet.resourceId.videoId;
‎        const videoTitle = latest.snippet.title;
‎        const videoRes = await youtube.videos.list({ part: 'contentDetails', id: videoId });
‎        const duration = videoRes.data.items[0].contentDetails.duration;
‎        const seconds = parseDuration(duration);
‎        const isShort = seconds <= 60;
‎        
‎        if (!user.lastVideoIds[channelId]) user.lastVideoIds[channelId] = null;
‎        const isNew = videoId !== user.lastVideoIds[channelId];
‎        
‎        if (isNew && isShort) {
‎            user.lastVideoIds[channelId] = videoId;
‎            console.log(`User ${userId}: New Short from ${channelId}: ${videoTitle}`);
‎            
‎            let canPost = true;
‎            if (user.dailyLimit !== null && user.dailyPosts >= user.dailyLimit) canPost = false;
‎            
‎            if (user.videoSupply.length > 0 && canPost) {
‎                await new Promise(resolve => setTimeout(resolve, user.settings.postDelay * 1000));
‎                await postYourVideo(bot, userId, channelId, videoTitle);
‎            } else if (user.videoSupply.length === 0 && user.settings.yourChannelId) {
‎                await bot.telegram.sendMessage(user.settings.yourChannelId, `🎬 New Short detected but no videos in supply! Upload videos to your private channel.`);
‎            }
‎        }
‎    } catch (error) {
‎        console.error(`User ${userId}: Error:`, error.message);
‎        if (error.message.includes('API key') && user.settings.yourChannelId) {
‎            await bot.telegram.sendMessage(user.settings.yourChannelId, `❌ Invalid YouTube API key! Use /setapikey`);
‎        }
‎    }
‎}
‎
‎function resetDailyCounters() {
‎    const now = new Date();
‎    const today = now.toDateString();
‎    for (const userId in userData) {
‎        if (userData[userId].lastPostDate !== today) {
‎            userData[userId].dailyPosts = 0;
‎            userData[userId].lastPostDate = today;
‎        }
‎    }
‎    saveUserData();
‎}
‎
‎async function monitorAllUsers(bot) {
‎    console.log('🔍 Starting multi-user monitoring...');
‎    while (true) {
‎        resetDailyCounters();
‎        for (const userId in userData) {
‎            const user = userData[userId];
‎            if (user.settings.isMonitoring && user.settings.youtubeApiKey && user.monitoredChannels.length > 0) {
‎                for (const channelId of user.monitoredChannels) {
‎                    await checkChannel(bot, userId, channelId);
‎                }
‎            }
‎        }
‎        await new Promise(resolve => setTimeout(resolve, 10000));
‎    }
‎}
‎
‎// ========== AUTO-DETECT VIDEOS FROM PRIVATE CHANNEL ==========
‎async function scanPrivateChannel(bot, userId) {
‎    const user = userData[userId];
‎    if (!user || !user.settings.privateChannelId) return;
‎    if (!user.settings.autoAddVideos) return;
‎    
‎    try {
‎        // Get last 50 messages from private channel
‎        const messages = await bot.telegram.getChatHistory(user.settings.privateChannelId, {
‎            limit: 50
‎        });
‎        
‎        let newVideos = [];
‎        
‎        for (const msg of messages) {
‎            // Skip already processed messages
‎            if (user.lastProcessedMessageId && msg.message_id <= user.lastProcessedMessageId) continue;
‎            
‎            // Check if message has video
‎            if (msg.video || msg.document?.mimeType?.startsWith('video/')) {
‎                const videoId = msg.message_id;
‎                const caption = msg.caption || null;
‎                
‎                // Check if already in supply
‎                const alreadyExists = user.videoSupply.some(v => v.messageId === videoId);
‎                
‎                if (!alreadyExists) {
‎                    newVideos.push({ messageId: videoId, description: caption });
‎                    console.log(`User ${userId}: Auto-detected video ${videoId} from private channel`);
‎                }
‎            }
‎            
‎            // Update last processed message ID
‎            if (!user.lastProcessedMessageId || msg.message_id > user.lastProcessedMessageId) {
‎                user.lastProcessedMessageId = msg.message_id;
‎            }
‎        }
‎        
‎        // Add new videos to supply (at the end of queue)
‎        if (newVideos.length > 0) {
‎            user.videoSupply.push(...newVideos);
‎            saveUserData();
‎            console.log(`User ${userId}: Auto-added ${newVideos.length} videos from private channel. Total supply: ${user.videoSupply.length}`);
‎            
‎            // Notify user
‎            if (user.settings.yourChannelId) {
‎                await bot.telegram.sendMessage(
‎                    user.settings.yourChannelId,
‎                    `📦 Auto-detected ${newVideos.length} new video(s) from your private channel!\n` +
‎                    `Total videos in supply: ${user.videoSupply.length}`
‎                );
‎            }
‎        }
‎    } catch (error) {
‎        console.error(`User ${userId}: Error scanning private channel:`, error.message);
‎    }
‎}
‎
‎async function monitorPrivateChannels(bot) {
‎    console.log('🔍 Starting private channel monitoring for auto-detecting videos...');
‎    while (true) {
‎        for (const userId in userData) {
‎            const user = userData[userId];
‎            if (user.settings.privateChannelId && user.settings.autoAddVideos) {
‎                await scanPrivateChannel(bot, userId);
‎            }
‎        }
‎        await new Promise(resolve => setTimeout(resolve, 30000)); // Check every 30 seconds
‎    }
‎}
‎
‎// ========== BOT COMMANDS ==========
‎const bot = new Telegraf(BOT_TOKEN);
‎
‎// Start command
‎bot.command('start', async (ctx) => {
‎    const userId = ctx.from.id;
‎    initUser(userId, ctx.from.username, ctx.from.first_name);
‎    await ctx.reply(
‎        `🤖 *YouTube to Telegram Bot*\n\n` +
‎        `Welcome ${ctx.from.first_name || 'User'}! 👋\n\n` +
‎        `📋 *Quick Setup:*\n` +
‎        `1. /setapikey YOUR_API_KEY\n` +
‎        `2. /setchannel @yourchannel\n` +
‎        `3. /setprivate -1001234567890 (YOUR private channel)\n` +
‎        `4. /addchannel UCxxxxxx (YouTube channel to monitor)\n` +
‎        `5. /startmonitor\n\n` +
‎        `📹 *Auto Video Detection:*\n` +
‎        `• Just upload videos to your private channel\n` +
‎        `• Bot automatically adds them to supply\n` +
‎        `• No need for /addvideo command!\n\n` +
‎        `📝 *Optional:* /setdescription "Default caption"\n\n` +
‎        `📊 /help for all commands`,
‎        { parse_mode: 'Markdown' }
‎    );
‎});
‎// Help command
‎bot.command('help', async (ctx) => {
‎    await ctx.reply(
‎        `🤖 *Commands*\n\n` +
‎        `🔑 *Setup:*\n` +
‎        `/setapikey <key> - Set YouTube API key\n` +
‎        `/setchannel <id> - Set your Telegram channel\n` +
‎        `/setprivate <id> - Set your PRIVATE channel (where you upload videos)\n` +
‎        `/setlimit <num> - Set daily post limit (0=unlimited)\n\n` +
‎        `📝 *Description:*\n` +
‎        `/setdescription <text> - Set default caption\n` +
‎        `/showdescription - Show current default\n` +
‎        `/cleardescription - Remove default\n\n` +
‎        `🎯 *YouTube Channels:*\n` +
‎        `/addchannel <id> - Add channel to monitor\n` +
‎        `/removechannel <id> - Remove channel\n` +
‎        `/listchannels - List monitored channels\n\n` +
‎        `📦 *Video Supply (Auto-detected):*\n` +
‎        `/supply - Check remaining videos\n` +
‎        `/clearsupply - Clear all videos\n` +
‎        `/autoaddon - Enable auto-add videos\n` +
‎        `/autoaddoff - Disable auto-add videos\n\n` +
‎        `⚙️ *Settings:*\n` +
‎        `/setinterval <sec> - Check interval (default: 60)\n` +
‎        `/setdelay <sec> - Post delay (default: 60)\n` +
‎        `/status - Show bot status\n\n` +
‎        `🎬 *Control:*\n` +
‎        `/startmonitor - Start monitoring\n` +
‎        `/stopmonitor - Stop monitoring\n\n` +
‎        `👤 *Info:*\n` +
‎        `/myid - Show your Telegram ID\n` +
‎        `/stats - Show your personal stats\n\n` +
‎        `👑 *Admin:*\n` +
‎        `/adminstats - View all users\n` +
‎        `/broadcast <msg> - Send to all users\n\n` +
‎        `📝 *Placeholders:* {channel} {title} {date} {time} {user}`,
‎        { parse_mode: 'Markdown' }
‎    );
‎});
‎
‎// User info
‎bot.command('myid', async (ctx) => {
‎    await ctx.reply(`🆔 Your ID: \`${ctx.from.id}\``, { parse_mode: 'Markdown' });
‎});
‎
‎// User stats
‎bot.command('stats', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    await ctx.reply(
‎        `📊 *Your Stats*\n\n` +
‎        `• Joined: ${new Date(user.joinedAt).toLocaleDateString()}\n` +
‎        `• Videos in supply: ${user.videoSupply.length}\n` +
‎        `• Total posts: ${user.totalPosts || 0}\n` +
‎        `• Today's posts: ${user.dailyPosts}\n` +
‎        `• Daily limit: ${user.dailyLimit === null ? 'Unlimited' : user.dailyLimit}\n` +
‎        `• Monitoring: ${user.settings.isMonitoring ? '🟢 Active' : '🔴 Stopped'}\n` +
‎        `• Auto-add videos: ${user.settings.autoAddVideos ? '✅ ON' : '❌ OFF'}`,
‎        { parse_mode: 'Markdown' }
‎    );
‎});
‎
‎// Auto-add video toggles
‎bot.command('autoaddon', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    user.settings.autoAddVideos = true;
‎    saveUserData();
‎    await ctx.reply(`✅ Auto-add videos ENABLED\n\nVideos you upload to your private channel will be automatically added to supply.`);
‎});
‎
‎bot.command('autoaddoff', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    user.settings.autoAddVideos = false;
‎    saveUserData();
‎    await ctx.reply(`❌ Auto-add videos DISABLED\n\nYou will need to use /addvideo manually.`);
‎});
‎
‎// Description commands
‎bot.command('setdescription', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const description = ctx.message.text.replace('/setdescription', '').trim();
‎    if (!description) {
‎        return ctx.reply('Usage: /setdescription Your default caption\n\nPlaceholders: {channel} {title} {date} {time} {user}');
‎    }
‎    user.settings.defaultDescription = description;
‎    saveUserData();
‎    await ctx.reply(`✅ Default description set!\n\nPreview: ${description.replace(/{.*?}/g, 'EXAMPLE')}`);
‎});
‎
‎bot.command('showdescription', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    if (user.settings.defaultDescription) {
‎        await ctx.reply(`📝 *Current default description:*\n\n${user.settings.defaultDescription}`, { parse_mode: 'Markdown' });
‎    } else {
‎        await ctx.reply('📝 No default description set. Use /setdescription to add one.');
‎    }
‎});
‎
‎bot.command('cleardescription', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    user.settings.defaultDescription = null;
‎    saveUserData();
‎    await ctx.reply('✅ Default description cleared!');
‎});
‎
‎// Setup commands
‎bot.command('setapikey', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const args = ctx.message.text.split(' ');
‎    if (args.length < 2) return ctx.reply('Usage: /setapikey YOUR_API_KEY');
‎    user.settings.youtubeApiKey = args[1];
‎    saveUserData();
‎    await ctx.reply('✅ YouTube API key saved!');
‎});
‎
‎bot.command('setchannel', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const args = ctx.message.text.split(' ');
‎    if (args.length < 2) return ctx.reply('Usage: /setchannel @channel OR -1001234567890');
‎    user.settings.yourChannelId = args[1].startsWith('@') ? args[1] : parseInt(args[1]);
‎    saveUserData();
‎    await ctx.reply(`✅ Your public channel set to: ${user.settings.yourChannelId}`);
‎});
‎
‎bot.command('setprivate', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const args = ctx.message.text.split(' ');
‎    if (args.length < 2) return ctx.reply('Usage: /setprivate -1001234567890\n\nThis is your PRIVATE channel where you upload videos. Bot will auto-detect them.');
‎    user.settings.privateChannelId = parseInt(args[1]);
‎    saveUserData();
‎    await ctx.reply(`✅ Private channel set to: ${user.settings.privateChannelId}\n\nBot will now auto-detect videos you upload here!`);
‎    
‎    // Scan immediately
‎    await scanPrivateChannel(bot, ctx.from.id);
‎});
‎
‎bot.command('setlimit', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const args = ctx.message.text.split(' ');
‎    if (args.length < 2) return ctx.reply('Usage: /setlimit 10 (0 = unlimited)');
‎    const limit = parseInt(args[1]);
‎    user.dailyLimit = limit === 0 ? null : limit;
‎    saveUserData();
‎    await ctx.reply(`✅ Daily limit: ${user.dailyLimit === null ? 'Unlimited' : user.dailyLimit}`);
‎});
‎
‎// Channel management
‎bot.command('addchannel', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const args = ctx.message.text.split(' ');
‎    if (args.length < 2) return ctx.reply('Usage: /addchannel UCxxxxxx');
‎    if (!user.settings.youtubeApiKey) return ctx.reply('❌ Set API key first: /setapikey');
‎    const channelId = args[1];
‎    if (user.monitoredChannels.includes(channelId)) return ctx.reply('❌ Already monitoring');
‎    user.monitoredChannels.push(channelId);
‎    saveUserData();
‎    await ctx.reply(`✅ Added ${channelId} | Total: ${user.monitoredChannels.length}`);
‎});
‎
‎bot.command('removechannel', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const args = ctx.message.text.split(' ');
‎    if (args.length < 2) return ctx.reply('Usage: /removechannel UCxxxxxx');
‎    const index = user.monitoredChannels.indexOf(args[1]);
‎    if (index === -1) return ctx.reply('❌ Channel not found');
‎    user.monitoredChannels.splice(index, 1);
‎    delete user.lastVideoIds[args[1]];
‎    saveUserData();
‎    await ctx.reply(`✅ Removed | Total: ${user.monitoredChannels.length}`);
‎});
‎
‎bot.command('listchannels', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    if (user.monitoredChannels.length === 0) return ctx.reply('No channels monitored');
‎    await ctx.reply(`🎯 *Monitored:*\n${user.monitoredChannels.map((id, i) => `${i+1}. ${id}`).join('\n')}`, { parse_mode: 'Markdown' });
‎});
‎
‎// Supply commands
‎bot.command('supply', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    let supplyText = `📦 *Video Supply:* ${user.videoSupply.length} videos\n\n`;
‎    if (user.videoSupply.length > 0) {
‎        const next = user.videoSupply[0];
‎        supplyText += `🎯 *Next video ID:* ${next.messageId}\n`;
‎        supplyText += `📝 *Caption:* ${next.description ? next.description.substring(0, 50) + (next.description.length > 50 ? '...' : '') : 'None'}\n\n`;
‎        supplyText += `💡 *Tip:* Upload new videos to your private channel - they auto-add to the end of queue!`;
‎    } else {
‎        supplyText += `📭 *No videos in supply*\n\n💡 *Tip:* Upload videos to your private channel and they will auto-add here!`;
‎    }
‎    await ctx.reply(supplyText, { parse_mode: 'Markdown' });
‎});
‎
‎bot.command('clearsupply', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const removed = user.videoSupply.length;
‎    user.videoSupply = [];
‎    saveUserData();
‎    await ctx.reply(`🔄 Cleared ${removed} videos from supply.`);
‎});
‎
‎// Settings commands
‎bot.command('setinterval', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const args = ctx.message.text.split(' ');
‎    if (args.length < 2) return ctx.reply(`Current: ${user.settings.monitorInterval}s`);
‎    const interval = parseInt(args[1]);
‎    if (isNaN(interval) || interval < 10) return ctx.reply('❌ Minimum 10 seconds');
‎    user.settings.monitorInterval = interval;
‎    saveUserData();
‎    await ctx.reply(`✅ Check interval: ${interval}s`);
‎});
‎
‎bot.command('setdelay', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    const args = ctx.message.text.split(' ');
‎    if (args.length < 2) return ctx.reply(`Current: ${user.settings.postDelay}s`);
‎    const delay = parseInt(args[1]);
‎    if (isNaN(delay) || delay < 0) return ctx.reply('❌ Invalid');
‎    user.settings.postDelay = delay;
‎    saveUserData();
‎    await ctx.reply(`✅ Post delay: ${delay}s`);
‎});
‎
‎// Status command
‎bot.command('status', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    await ctx.reply(
‎        `🤖 *Status*\n\n` +
‎        `🔑 API: ${user.settings.youtubeApiKey ? '✅' : '❌'}\n` +
‎        `📤 Your channel: ${user.settings.yourChannelId || '❌'}\n` +
‎        `📥 Private channel: ${user.settings.privateChannelId || '❌'}\n` +
‎        `🤖 Auto-add videos: ${user.settings.autoAddVideos ? '✅ ON' : '❌ OFF'}\n` +
‎        `🎯 Monitored: ${user.monitoredChannels.length} channels\n` +
‎        `📦 Supply: ${user.videoSupply.length} videos\n` +
‎        `📊 Today: ${user.dailyPosts}/${user.dailyLimit === null ? '∞' : user.dailyLimit}\n` +
‎        `🟢 Monitoring: ${user.settings.isMonitoring ? 'Active' : 'Stopped'}\n` +
‎        `📝 Description: ${user.settings.defaultDescription ? '✅ Set' : '❌ Not set'}\n` +
‎        `⏱️ Check: ${user.settings.monitorInterval}s | Delay: ${user.settings.postDelay}s`,
‎        { parse_mode: 'Markdown' }
‎    );
‎});
‎
‎// Control commands
‎bot.command('startmonitor', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    if (!user.settings.youtubeApiKey) return ctx.reply('❌ Set API key first: /setapikey');
‎    if (!user.settings.yourChannelId) return ctx.reply('❌ Set channel first: /setchannel');
‎    if (!user.settings.privateChannelId) return ctx.reply('❌ Set private channel first: /setprivate');
‎    if (user.monitoredChannels.length === 0) return ctx.reply('❌ Add YouTube channels: /addchannel');
‎    if (user.videoSupply.length === 0) return ctx.reply('⚠️ Supply empty! Upload videos to your private channel.');
‎    user.settings.isMonitoring = true;
‎    saveUserData();
‎    await ctx.reply(`🟢 Monitoring started!\n\n📊 ${user.monitoredChannels.length} channels\n📦 ${user.videoSupply.length} videos\n⏱️ Check: ${user.settings.monitorInterval}s | Delay: ${user.settings.postDelay}s`);
‎});
‎
‎bot.command('stopmonitor', async (ctx) => {
‎    const user = initUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
‎    user.settings.isMonitoring = false;
‎    saveUserData();
‎    await ctx.reply(`🔴 Monitoring stopped`);
‎});
‎
‎// Admin commands
‎bot.command('adminstats', async (ctx) => {
‎    if (ADMIN_ID && ctx.from.id !== ADMIN_ID) return ctx.reply('❌ Admin only');
‎    const stats = getUserStats();
‎    let userList = '';
‎    let count = 0;
‎    for (const uid in userData) {
‎        if (count++ >= 10) break;
‎        const u = userData[uid];
‎        userList += `${count}. \`${uid}\` | @${u.username || '?'} | 📦${u.videoSupply.length} | ${u.settings.isMonitoring ? '🟢' : '🔴'}\n`;
‎    }
‎    await ctx.reply(
‎        `👥 *Bot Statistics*\n\n` +
‎        `📊 Total users: ${stats.totalUsers}\n` +
‎        `🟢 Active monitors: ${stats.activeUsers}\n` +
‎        `🎯 Monitored channels: ${stats.totalMonitoredChannels}\n` +
‎        `📦 Videos in supply: ${stats.totalVideosInSupply}\n` +
‎        `📊 Total posts all time: ${stats.totalPostsAllTime}\n\n` +
‎        `👤 *Recent Users:*\n${userList}`,
‎        { parse_mode: 'Markdown' }
‎    );
‎});
‎
‎bot.command('broadcast', async (ctx) => {
‎    if (ADMIN_ID && ctx.from.id !== ADMIN_ID) return ctx.reply('❌ Admin only');
‎    const message = ctx.message.text.replace('/broadcast', '').trim();
‎    if (!message) return ctx.reply('Usage: /broadcast Your message');
‎    let sent = 0, failed = 0;
‎    for (const uid in userData) {
‎        try {
‎            await ctx.telegram.sendMessage(parseInt(uid), `📢 *Announcement*\n\n${message}`, { parse_mode: 'Markdown' });
‎            sent++;
‎        } catch (e) { failed++; }
‎        await new Promise(r => setTimeout(r, 50));
‎    }
‎    await ctx.reply(`✅ Sent: ${sent} | Failed: ${failed}`);
‎});
‎
‎// Start bot
‎bot.launch()
‎    .then(() => {
‎        console.log('🤖 Bot started!');
‎        console.log(`👥 Users: ${Object.keys(userData).length}`);
‎        console.log(`👑 Admin ID: ${ADMIN_ID || 'Not set'}`);
‎        monitorAllUsers(bot);
‎        monitorPrivateChannels(bot);
‎    })
‎    .catch(err => console.error('Failed:', err));
‎
‎process.once('SIGINT', () => bot.stop('SIGINT'));
‎process.once('SIGTERM', () => bot.stop('SIGTERM'));
‎
‎
