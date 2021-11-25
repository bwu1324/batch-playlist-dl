const ytdl = require('ytdl-core');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

process.env.YTDL_NO_UPDATE = 1;

process.on('message', async (message) => {
	try {
		var info = await ytdl.getInfo(message.link);
		var audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
		var highestQuality = ytdl.chooseFormat(audioFormats, 'highestaudio');

		var stream = ytdl(message.link, { quality: highestQuality.itag });

		ffmpeg()
			.input(stream)
			.audioCodec(message.codec)
			.output(message.output)
			.on('start', () => {
				console.log(`Started downloading video: ${message.title}`);
			})
			.on('end', () => {
				console.log(`Finished downloading video: ${message.title}`);
				process.send(true);
			})
			.on('error', (error) => {
				console.log(error);
				process.send(false);
			})
			.run();
	} catch (error) {
		console.log(`Error while downloading video: ${message.title}`);
		console.log(error);
		process.send(false);
	}
});