#!/usr/bin/env node

import { io } from 'socket.io-client';
import terminal_kit from 'terminal-kit';
import { DateTime } from 'luxon';
import { CronJob } from 'cron';
import uniqid from 'uniqid';
import path from 'path';
import fs from 'fs';
import EventEmitter from 'events';
class MonitorEvent extends EventEmitter {}
const monitorEvent = new MonitorEvent();
import { Command, Option } from 'commander/esm.mjs';
const program = new Command();
const { terminal } = terminal_kit;

//  node instant.mjs --id testquery --term 2021/10/01T00:00-2021/10/05T00:00 --keywords コロナ マスク --url ws://tokyo004:45803/ --webdav --destination https://file.tmu.ac:4580/home/Drive/labo/twitter/ --user shohei.yokoyama

//  node instant.mjs --id eguchi20211208 --term 2021/02/01T00:00-2021/04/01T00:00 --keywords COVID-19 vaccin --url ws://tokyo004:45803/ --webdav --destination https://file.tmu.ac:4580/home/Drive/labo/twitter/ --user shohei.yokoyama

// node instant.mjs --id narita20211208 --term 2020/05/01T00:00-2021/07/01T00:00 --keywords コロナ --url ws://tokyo004:45803/ --webdav --destination https://file.tmu.ac:4580/home/Drive/labo/twitter/ --user shohei.yokoyama

program
    .requiredOption('-i, --id <id>', 'Query Identifier')
    .requiredOption('-u, --url <url>', 'URL of WebSocket Server')
    .requiredOption(
        '-t, --term <yyyy/mm/ddThh:mm-yyyy/mm/ddThh:mm>',
        'Search Term'
    )
    .addOption(
        new Option('--keywords-match <method>', 'Text Match Method').choices([
            'text-and',
            'text-or',
            'RegExp',
        ]).default('text-or', 'Text OR')
    )
    .requiredOption(
        '-k, --keywords <word...>',
        'Comma Separated Search Keywords'
    )
    .addOption(
        new Option('-l, --lang <lang>', 'Language').choices(['ja', 'en'])
    )
    .option('-m, --mask', 'JSON Mask (https://www.npmjs.com/package/json-mask)')
    .option('--ignore-retweet', 'Ignore Retweet')
    .option('--only-retweet', 'Only Retweet')
    .option('-w, --webdav', 'Upload to Webdav Server')
    .option(
        '-d, --destination <url>',
        'Save Location (WebDAV)'
    )
    .option('-n, --user <username>', 'Username for Webdav Server');

program.parse();
const options = program.opts();

let password;
if (options.webdav) {
    terminal('Password for the webdav server:');
    password = await terminal.inputField({
        echoChar: true,
    }).promise;
    terminal('\nThank you for telling me your password! 😋\n');
}

const HOME_DIR =
    process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'];
const monitorIdFile = path.join(HOME_DIR, '.parallel-full-twitter');
const monitorId = fs.existsSync(monitorIdFile)
    ? fs.readFileSync(monitorIdFile, { encoding: 'utf8' })
    : uniqid('PFT');
if (!fs.existsSync(monitorIdFile)) {
    fs.writeFileSync(monitorIdFile, monitorId, { flag: 'w+' });
}

const term = options.term.split('-').map((term) => {
    const dt = term.split('T');
    return dt[0] + ' ' + dt[1];
});
const query = {
    title: options.id,
    from: DateTime.fromFormat(term[0], 'yyyy/MM/dd HH:mm').toISO(),
    to: DateTime.fromFormat(term[1], 'yyyy/MM/dd HH:mm').toISO(),
    keywordsMatch: options.keywordsMatch, //,"text-and" or "RegExp"
    keywords: options.keywords,
    //hashtagsMatch:"text-or", //,"text-and" or "RegExp"
    //hashtags:["コロナ"],
    //urlsMatch:"text-or", //,"text-and" or "RegExp"
    //urls:[""],
    //lang: 'ja',
    filters: [], //ignore_retweet, only_retweet
    mask: options.mask,
};
if (options.mask) {
    query.mask = options.mask;
} else {
    query.mask =
        'id_str,text,user(id_str,name,screen_name),is_quote_status,quoted_status_id_str,retweeted_status(id_str,user(id_str,name,screen_name)),entities(hashtags,user_mentions,urls),lang,timestamp_ms,created_at';
}
if (options.lang) {
    query.lang = options.lang;
}
if (options.ignoreRetweet) {
    query.filters.push('ignore_retweet');
}
if (options.onlyRetweet) {
    query.filters.push('only_retweet');
}
const queryId = monitorId + '_' + uniqid();
console.log(query, queryId);
process.exit();
//console.log(options.url);
const socket = io(options.url);
socket.on('connect', async () => {
    socket.emit('query', { queryId, query });
    let job = new CronJob('*/5 * * * * *', () => {
        socket.emit('progress', { queryId, query }, (response) => {
            if (response.all != 0) {
                if (response.done == response.all) {
                    job.stop();
                }
                terminal.clear();
                terminal(response.done + '/' + response.all);
            }
        });
    });
    job.start();
    socket.on('query-return', (response) => {
        terminal();
        /* console.log({
            queryId: response.queryId,
            archiveFile: response.archiveFile,
        });*/
        if (options.webdav) {
            socket.emit(
                'webdav',
                {
                    queryId: path.basename(response.archiveFile, '.tgz'),
                    name: options.name,
                    user: options.user,
                    password: password,
                    url: options.destination + options.id + '.tgz',
                },
                (response) => {
                    //console.log("webdab",response);
                    console.log('[ALL DONE]');
                }
            );
        }
    });
});
let doubleCTRL_C = false;
terminal.on('key', async function (name, matches, data) {
    if (name === 'CTRL_C') {
        if (!doubleCTRL_C) {
            doubleCTRL_C = true;
            terminal('\nQuit? [Y|n]\n');
            let yn = await terminal.yesOrNo({ yes: ['y', 'ENTER'], no: ['n'] })
                .promise;
            if (yn) {
                terminal.processExit();
            } else {
                doubleCTRL_C = false;
            }
        } else {
            terminal.processExit();
        }
    }
});
