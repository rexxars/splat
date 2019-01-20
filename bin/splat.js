#!/usr/bin/env node
/* eslint-disable no-await-in-loop, no-console */
const path = require('path')
const fs = require('mz/fs')
const meow = require('meow')
const inquirer = require('inquirer')
const sortObject = require('deep-sort-object')
const crypto = require('crypto')

const cli = meow(
  `
  Usage
  $ splat <output-path>

  Options
  --from  Template to use

  Examples
  $ splat --from react ./that-folder
  `,
  {
    flags: {
      from: {
        default: 'default',
        type: 'string'
      }
    }
  }
)

const defaultsPath = path.join(__dirname, '..', 'defaults')
const outputDir = path.resolve(process.cwd(), cli.input[0] || './')
const templatePath = path.join(defaultsPath, cli.flags.from)

run()

async function run() {
  await fs
    .stat(templatePath)
    .then(throwIfNonDir(cli.flags.from))
    .catch(throwOnMissingTemplate(cli.flags.from))

  const files = await fs.readdir(templatePath)

  let changes = 0
  changes += await copyFiles(getCopyableFiles(files))
  changes += await updatePackageJson(files)

  if (changes > 0) {
    console.log('Done splatting!')
  } else {
    console.log('Desination matches template, no changes performed')
  }
}

async function updatePackageJson(files) {
  const hasPackageJson = files.includes('package.json')
  if (!hasPackageJson) {
    return 0
  }

  const destHasPackageJson = await fs.exists(path.join(outputDir, 'package.json'))
  if (!destHasPackageJson) {
    await fs.copyFile(path.join(templatePath, 'package.json'), path.join(outputDir, 'package.json'))
    console.log('Wrote package.json with dependencies, run npm i/yarn to install them')
    return 1
  }

  const pkg = require(path.join(templatePath, 'package.json'))
  const dstPkg = require(path.join(outputDir, 'package.json'))

  const dependencies = sortObject({...(dstPkg.dependencies || {}), ...(pkg.dependencies || {})})
  const devDependencies = sortObject({
    ...(dstPkg.devDependencies || {}),
    ...(pkg.devDependencies || {})
  })

  const newPkg = JSON.stringify({...dstPkg, dependencies, devDependencies}, null, 2)
  const oldPkg = JSON.stringify(dstPkg, null, 2)
  const hasChanged = newPkg !== oldPkg

  if (hasChanged) {
    await fs.writeFile(path.join(outputDir, 'package.json'), newPkg)
    console.log('Updated package.json with new dependencies, run npm i/yarn to install them')
  }

  return hasChanged ? 1 : 0
}

async function copyFiles(files) {
  let copied = 0
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const sourcePath = path.join(templatePath, file)
    const destinationPath = path.join(outputDir, file)

    const [sourceHash, targetHash] = await Promise.all([
      hashFile(sourcePath),
      hashFile(destinationPath).catch(allowNotExist)
    ])

    let doCopy = true
    if (targetHash && sourceHash !== targetHash) {
      doCopy = await plzConfirm(`File "${file}" already exists - replace?`)
    } else if (sourceHash === targetHash) {
      doCopy = false
    }

    if (!doCopy) {
      continue
    }

    console.log(`Splatting ${file}...`)
    await fs.copyFile(path.join(templatePath, file), destinationPath)
    copied++
  }

  return copied
}

function throwOnMissingTemplate(template) {
  return err => {
    if (err.code === 'ENOENT') {
      throw new Error(`Template "${template}" not found`)
    }

    throw err
  }
}

function throwIfNonDir(template) {
  return stat => {
    if (!stat.isDirectory()) {
      throw new Error(`Template "${template}" is not a directory`)
    }

    return stat
  }
}

function getCopyableFiles(files) {
  return files.filter(file => file !== 'package.json')
}

function plzConfirm(message, defaultVal = false) {
  return inquirer
    .prompt([
      {
        type: 'confirm',
        name: 'confirmation',
        message,
        default: defaultVal
      }
    ])
    .then(answers => answers.confirmation)
}

function hashFile(file) {
  const hash = crypto.createHash('sha1')
  return new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

function allowNotExist(err) {
  if (err.code !== 'ENOENT') {
    throw err
  }

  return null
}
