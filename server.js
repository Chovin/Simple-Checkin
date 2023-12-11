const express = require('express')
const app = express()
let port = 80
const path = require('path');
const fs = require('fs')
const fsa = require('fs').promises
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('express-async-handler')

if (process.argv.length >= 3) {
  port = parseInt(process.argv[2])
}

const output_folder = 'checkins'
const checkins = {}
const queues = {}
let files = []

if (!fs.existsSync(output_folder)) {
  fs.mkdirSync(output_folder)
}

function outputFile() {
  return `${getToday()}-checkins.csv`
}

const bodyParser = require('body-parser')
app.use(bodyParser.json())

// Render Html File
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'templates/index.html'));
});

app.get('/dashboard', function(req, res) {
  res.sendFile(path.join(__dirname, 'templates/dashboard.html'));
})

function rollDate(date) {
  if (!checkins[date]) {
    for (let k in checkins) {
      delete checkins[k]
    }
    checkins[date] = []
  }
}

function getToday(date = null) {
  let today = date || new Date()
  let today_str = today.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' , timeZone: 'Pacific/Guam' })
  today = new Date(today_str)
  const year = today.getFullYear()
  const month = String(today.getMonth()+1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  today_str = `${year}-${month}-${day}`
  // today_str = `${year}-${month}`
  return today_str
}

function loadTodayCheckins() {
  let today = getToday()
  let fn = path.join(output_folder, today, outputFile())

  fs.readFile(fn, 'utf8', (err, data) => {
    if (err) return;
    checkins[today] = data.split('\n').map((ln) => {
      let [name, membership, datetime] = ln.replaceAll('"','').split(',')
      if (!datetime) {return}
      return {name, membership, datetime}
    }).filter((i)=>i)
  })

}
loadTodayCheckins()

app.get('/checkins', function(req, res) {
  const today_str = getToday()
  rollDate(today_str)
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(checkins[today_str]));
})

setInterval(generateFileList, 60*60)
generateFileList()

function generateFileList() {
  files = []
  fs.readdir(output_folder, {}, (err, folders) => {
    if (err) console.log(err)
    folders.forEach((f) => {
      fs.readdir(path.join(output_folder, f), {}, (err, fns) => {
        if (err) console.log(err)
        fns.forEach((fn) => {
          files.push(fn)
        })
      })
    })
  })
}

app.get('/files', function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify([...files].sort()));
})

app.get('/files/:name', function(req, res) {
  let name = req.params.name
  let date = name.substring(0, name.lastIndexOf("-"));
  let f = path.join(output_folder, date, name)
  fs.readFile(f, 'utf8', (err, data) => {
    if (err) {console.log(err); return}
    res.attachment(name).send(data)
  })
})

app.get('/export', asyncHandler(async (req,res,next) => {
  let from = req.query.from
  let to = req.query.to
  let fromDate = new Date(from)
  let toDate = new Date(to)
  // figure out more performant sort and/or binary search later
  let s = "Membership Number,Name,Datetime\n"
  for (let fn of [...files].sort()) {
    let date = fn.substring(0, fn.lastIndexOf("-"));
    let d = new Date(date)
    if (d >= fromDate) {
      let contents = await fsa.readFile(path.join(output_folder, date, fn), "utf8")
      contents = contents.trim()
      if (contents) {
        s += contents + '\n'
      }
      if (d >= toDate) {
        break
      }
    }
  }
  res.attachment(`${from} - ${to}.csv`).send(s)
  
}))

app.get('/checkins/stream', function(req, res) {
  let t = 0
  let max_stream_time = 4*60
  const queue = []
  const qid = uuidv4();
  queues[qid] = queue

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  
  let timer = setInterval(function() {
    while (queue.length > 0) {
      let item = queue.shift()
      
      res.write(`"${item.name}","${item.membership}",${item.datetime}\n`)
    }
    t += 1
    if (t > max_stream_time) {
      clearInterval(timer)
      delete queues[qid]
      res.end();
    }
  }, 1000)
})

app.post('/', async function(req, res) {
  const datetime = (new Date()).toLocaleString('en-US', {timeZone: 'Pacific/Guam'}).replace(',','')
  // console.log(date.toISOString({timezone: 'Pacific/Guam'}))

  const name = encodeURIComponent(req.body.name).replaceAll('%20',' ').trim()
  const membership = encodeURIComponent(req.body.membership).replaceAll('%20',' ').trim()
  
  const today_str = getToday()

  rollDate(today_str)

  let item = {
    name,
    membership,
    datetime
  }
  checkins[today_str].push(item)
  for (let qid in queues) {
    queues[qid].push(item)
  }
  
  
  const folder = path.join(output_folder, today_str)
  let error = false
  
  await fs.mkdir(folder, (err) => {
    if (err && err.errno !== -17) { // except folder exists
      console.log(err);
      error = err
    }
  })
  let s = `"${membership}","${name}",${datetime}\n`
  
  await fs.appendFile(path.join(folder, outputFile()), s, (err) => {
    if (err) {
      console.log(err);
      error = err
    }
  })
  res.end();
})


app.listen(port, () => {
  // Code.....
})