const fs = require('fs');
const sanitize = require('sanitize-filename');
const { fork } = require('child_process');
const ytpl = require('ytpl');
const path = require('path');

const settings = require(path.join(__dirname, 'settings.json'));

var saveProgress;
var globalPlaylist;
var index = 0;
var processing = 0;
async function getPlaylist() {
	var playlist;
	if (settings.resume) {
		console.log(`Attempting to resume download at output path: ${path.join(settings.outputPath, 'temp.json')}`);

		try {
			playlist = JSON.parse(fs.readFileSync(path.join(settings.outputPath, 'temp.json')));
		} catch (error) {
			console.log('Error resuming download, exiting...\n');
			throw error;
		}

		for (let i = 0; i < playlist.items.length; i++) {
			if (playlist.items[i].processed) {
				playlist.items.splice(i, 1);
			} else {
				console.log(`Found video: ${playlist.items[i].duration} - ${playlist.items[i].title}\t${playlist.items[i].url}`);
				playlist.items[i].retries = 0;
			}
		}

		console.log(`\nPlaylist name: ${playlist.title}\nURL: ${playlist.url}\nFound ${playlist.items.length} videos that have not finished downloading\n`);
	} else {
		console.log(`Loading playlist: ${settings.playlistLink}...`);

		playlist = await ytpl(settings.playlistLink, { limit: Infinity })

		for (let i = 0; i < playlist.items.length; i++) {
			console.log(`Found video: ${playlist.items[i].duration} - ${playlist.items[i].title}\t${playlist.items[i].url}`);
			playlist.items[i].processed = false;
			playlist.items[i].retries = 0;
		}

		console.log(`\nPlaylist name: ${playlist.title}\nURL: ${playlist.url}\nFound ${playlist.items.length} videos\n`);
	}

	return playlist;
}

function process(i) {
	globalPlaylist.items[i].processing = true;
	var subprocess = fork(path.join(__dirname, 'subprocess.js'));

	var info = {
		link: globalPlaylist.items[i].url,
		codec: settings.codec,
		title: globalPlaylist.items[i].title,
		output: path.join(settings.outputPath, sanitize(globalPlaylist.items[i].title + settings.outputExt))
	}

	subprocess.on('message', (success) => {
		globalPlaylist.items[i].processing = false;
		if (success) {
			globalPlaylist.items[i].processed = true;
			processing--;

			queue();
		} else {
			globalPlaylist.items[i].processed = false;
			globalPlaylist.items[i].retries++;
			processing--;

			queue();
		}
		subprocess.kill();
	})

	subprocess.send(info);
}

async function queue() {
	if (!settings.test) {
		while (processing < settings.maxParallel && index < globalPlaylist.items.length) {
			if (!globalPlaylist.items[index].processed && globalPlaylist.items[index].retries < settings.maxRetries && !globalPlaylist.items[index].processing) {
				process(index);
				processing++;
			}
			index++;
		}

		if (index === globalPlaylist.items.length) {
			var found = false;
			for (let i = 0; i < globalPlaylist.items.length; i++) {
				if (!globalPlaylist.items[i].processed && globalPlaylist.items[i].retries < settings.maxRetries && !globalPlaylist.items[i].processing) {
					found = true;
				}
			}

			if (found) {
				index = 0;
				queue();
			}
		}

		var finished = true;
		for (let i = 0; i < globalPlaylist.items.length; i++) {
			if (!globalPlaylist.items[i].processed) {
				finished = false;
			}
		}

		if (finished) {
			for (let i = 0; i < globalPlaylist.items.length; i++) {
				if (globalPlaylist.items[i].processed === false && globalPlaylist.items[i].retries < settings.maxRetries) {
					console.log(`Tried ${settings.maxRetries} times but video: ${globalPlaylist.items[i].title} failed to download`);
				}
			}
			clearInterval(saveProgress);
			fs.unlinkSync(path.join(settings.outputPath, 'temp.json'));
			console.log('Finished downloading');
		}
	}
}

(async () => {
	globalPlaylist = await getPlaylist();

	console.log('Preparing to download...');

	if (settings.maxParallel > globalPlaylist.items.length) {
		settings.maxParallel = globalPlaylist.items.length;
	}
	if (settings.test) {
		console.log('Set to test mode, downloading first video');
		process(0);
	} else {
		fs.writeFileSync(path.join(settings.outputPath, 'temp.json'), JSON.stringify(globalPlaylist));
		saveProgress = setInterval(() => {
			fs.writeFileSync(path.join(settings.outputPath, 'temp.json'), JSON.stringify(globalPlaylist));
		}, 5000);

		setTimeout(() => {
			queue()
		}, 3000);
	}
})();
