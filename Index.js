const { Telegraf } = require('telegraf');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || null;
const DATA_FILE = path.join(__dirname, 'userdata.json');

let userData = {};

if (fs.existsSync(DATA_FILE)) {
    try {
        userData = JSON.parse(fs.readFileSync(DATA_FILE));
        console.log(`📂 Loaded data for ${Object.keys(userData).length} users`);
    } catch (e) {
        userData = {};
    }
}

function saveUserData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(userData, null, 2));
        console.log('💾 User data saved');
    } catch (e) {
        console.error('❌ Error saving data:', e.message);
    }
}

function initUser(userId, username = null, firstName = null) {
    if (!userData[userId]) {
        userData[userId] = {
            userId: userId,
            username: username,
            firstName: firstName,
            joinedAt: new Date().toISOString(),
            lastActive: new Date().toISOString(),
            settings: {
                yourChannelId: null,
                privateChannelId: null,
                youtubeApiKey: null,
                monitorInterval: 60,
                postDelay: 60,
                isMonitoring: false,
                defaultTitle: null,
                autoAddVideos: true
            },
            videoSupply: [],
            monitoredChannels: [],
            lastVideoIds: {},
            lastPostDate: null,
            dailyPosts: 0,
            dailyLimit: null,
            totalPosts: 0,
            lastPostTime: null,
            lastProcessedMessageId: null
        };
        saveUserData();
        console.log(`👤 New user: ${userId} - Total: ${Object.keys(userData).length}`);
    } else {
        userData[userId].lastActive = new Date().toISOString();
        if (username) userData[userId].username = username;
        if (firstName) userData[userId].firstName = firstName;
        saveUserData();
    }
    return userData[userId];
}

function getUserStats() {
    const totalUsers = Object.keys(userData).length;
    let activeUsers = 0, totalMonitoredChannels = 0, totalVideosInSupply = 0, totalPostsAllTime = 0;
    for (const userId in userData) {
        const user = userData[userId];
        if (user.settings.isMonitoring) activeUsers++;
        totalMonitoredChannels += user.monitoredChannels.length;
        totalVideosInSupply += user.videoSupply.length;
        totalPostsAllTime += user.totalPosts || 0;
    }
    return { totalUsers, activeUsers, totalMonitoredChannels, totalVideosInSupply, totalPostsAllTime };
}

function getUserYoutubeClient(apiKey) {
    return google.youtube({ version: 'v3', auth: apiKey });
}

function parseDuration(duration) {
    const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    const minutes = parseInt(match[1]) || 0;
    const seconds = parseInt(match[2]) || 0;
    return minutes * 60 + seconds;
}

function getNextVideo(userId) {
    const user = userData[userId];
    if (!user || user.videoSupply.length === 0) return null;
    return user.videoSupply.shift();
}

async function postYourVideo(bot, userId, channelId, videoTitle) {
    const user = userData[userId];
    if (!user) return false;
    
    if (user.videoSupply.length === 0) {
        if (user.settings.yourChannelId) {
            await bot.telegram.sendMessage(user.settings.yourChannelId, `⚠️ Video supply empty! Upload videos to your private channel.`);
        }
        return false;
    }
    if (!user.settings.yourChannelId || !user.settings.privateChannelId) return false;
    
    const nextVideo = getNextVideo(userId);
    if (!nextVideo) return false;
    
    let titleText = '';
    
    if (nextVideo.title) {
        titleText = nextVideo.title;
    } else if (user.settings.defaultTitle) {
        titleText = user.settings.defaultTitle;
    }
    
    titleText = titleText
        .replace(/{channel}/g, channelId || 'Unknown')
        .replace(/{title}/g, videoTitle || 'YouTube Short')
        .replace(/{date}/g, new Date().toLocaleDateString())
        .replace(/{time}/g, new Date().toLocaleTimeString())
        .replace(/{user}/g, user.username || 'User');
    
    try {
        if (titleText) {
            await bot.telegram.sendMessage(user.settings.yourChannelId, titleText, { parse_mode: 'HTML' });
        }
        
        await bot.telegram.copyMessage(
            user.settings.yourChannelId,
            user.settings.privateChannelId,
            nextVideo.messageId
        );
        
        user.dailyPosts++;
        user.totalPosts = (user.totalPosts || 0) + 1;
        user.lastPostTime = new Date().toISOString();
        const remaining = user.videoSupply.length;
        console.log(`User ${userId}: Posted! Title: ${titleText ? 'Yes' : 'No'} | Remaining: ${remaining}`);
        
        if (remaining === 3 && user.settings.yourChannelId) {
            await bot.telegram.sendMessage(user.settings.yourChannelId, `⚠️ Low supply! Only ${remaining} videos left.`);
        }
        saveUserData();
        return true;
    } catch (error) {
        console.error(`User ${userId}: Post failed:`, error.message);
        user.videoSupply.unshift(nextVideo);
        return false;
    }
      }
async function checkChannel(bot, userId, channelId) {
    const user = userData[userId];
    if (!user || !user.settings.youtubeApiKey) return;
    
    const youtube = getUserYoutubeClient(user.settings.youtubeApiKey);
    try {
        const channelRes = await youtube.channels.list({ part: 'contentDetails', id: channelId });
        if (!channelRes.data.items.length) return;
        const playlistId = channelRes.data.items[0].contentDetails.relatedPlaylists.uploads;
        const playlistRes = await youtube.playlistItems.list({ part: 'snippet', playlistId, maxResults: 1 });
        if (!playlistRes.data.items.length) return;
        
        const latest = playlistRes.data.items[0];
        const videoId = latest.snippet.resourceId.videoId;
        const videoTitle = latest.snippet.title;
        const videoRes = await youtube.videos.list({ part: 'contentDetails', id: videoId });
        const duration = videoRes.data.items[0].contentDetails.duration;
        const seconds = parseDuration(duration);
        const isShort = seconds <= 60;
        
        if (!user.lastVideoIds[channelId]) user.lastVideoIds[channelId] = null;
        const isNew = videoId !== user.lastVideoIds[channelId];
        
        if (isNew && isShort) {
            user.lastVideoIds[channelId] = videoId;
            console.log(`User ${userId}: New Short from ${channelId}: ${videoTitle}`);
            
            let canPost = true;
            if (user.dailyLimit !== null && user.dailyPosts >= user.dailyLimit) canPost = false;
            
            if (user.videoSupply.length > 0 && canPost) {
                await new Promise(resolve => setTimeout(resolve, user.settings.postDelay * 1000));
                await postYourVideo(bot, userId, channelId, videoTitle);
            }
        }
    } catch (error) {
        console.error(`User ${userId}: Error:`, error.message);
        if (error.message.includes('API key') && user.settings.yourChannelId) {
            await bot.telegram.sendMessage(user.settings.yourChannelId, `❌ Invalid YouTube API key! Use /setapikey`);
        }
    }
}

function resetDailyCounters() {
    const now = new Date();
    const today = now.toDateString();
    for (const userId in userData) {
        if (userData[userId].lastPostDate !== today) {
            userData[userId].dailyPosts = 0;
            userData[userId].lastPostDate = today;
        }
    }
    saveUserData();
}

async function monitorAllUsers(bot) {
    console.log('🔍 Starting monitoring...');
    while (true) {
        resetDailyCounters();
        for (const userId in userData) {
            const user = userData[userId];
            if (user.settings.isMonitoring && user.settings.youtubeApiKey && user.monitoredChannels.length > 0) {
                for (const channelId of user.monitoredChannels) {
                    await checkChannel(bot, userId, channelId);
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
}

async function scanPrivateChannel(bot, userId) {
    const user = userData[userId];
    if (!user || !user.settings.privateChannelId) return;
    if (!user.settings.autoAddVideos) return;
    
    try {
        const messages = await bot.telegram.getChatHistory(user.settings.privateChannelId, { limit: 50 });
        let newVideos = [];
        
        for (const msg of messages) {
            if (user.lastProcessedMessageId && msg.message_id <= user.lastProcessedMessageId) continue;
            
            if (msg.video || (msg.document && msg.document.mimeType && msg.document.mimeType.startsWith('video/'))) {
                const videoId = msg.message_id;
                const title = msg.caption || null;
                const alreadyExists = user.videoSupply.some(v => v.messageId === videoId);
                
                if (!alreadyExists) {
                    newVideos.push({ messageId: videoId, title: title });
                    console.log(`User ${userId}: Auto-detected video ${videoId}`);
                }
            }
            
            if (!user.lastProcessedMessageId || msg.message_id > user.lastProcessedMessageId) {
                user.lastProcessedMessageId = msg.message_id;
            }
        }
        
        if (newVideos.length > 0) {
            user.videoSupply.push(...newVideos);
            saveUserData();
            console.log(`User ${userId}: Auto-added ${newVideos.length} videos. Total: ${user.videoSupply.length}`);
            
            if (user.settings.yourChannelId) {
                await bot.telegram.sendMessage(user.settings.yourChannelId, `📦 Auto-detected ${newVideos.length} new video(s)!\nTotal supply: ${user.videoSupply.length}`);
            }
        }
    } catch (error) {
        console.error(`User ${userId}: Error scanning:`, error.message);
    }
}

async function monitorPrivateChannels(bot) {
    console.log('🔍 Starting private channel monitoring...');
    while (true) {
        for (const userId in userData) {
            const user = userData[userId];
            if (user.settings.privateChannelId && user.settings.autoAddVideos) {
                await scanPrivateChannel(bot, userId);
            }
        }
        await new Promise(resolve => setTimeout(resolve, 30000));
    }
}

const bot = new Telegraf(BOT_TOKEN);
