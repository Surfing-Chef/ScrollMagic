#!/usr/bin/env node

"use strict";

/* ########################################## */
/* ########### load requirements ############ */
/* ########################################## */

var
	gulp =				require('gulp'),
	jshint =			require('gulp-jshint'),
	include =			require('gulp-file-include'),
	rename =			require('gulp-rename'),
	replace =			require('gulp-replace-task'),
	concat =			require('gulp-concat-util'),
	uglify =			require('gulp-uglify'),
	gulpFilter =	require('gulp-filter'),
	gutil = 			require('gulp-util'),
	jeditor = 		require('gulp-json-editor'),
	// jsdoc = 			require('gulp-jsdoc'),
	clone = 			require('gulp-clone'),
	addsrc = 			require('gulp-add-src'),

	fs = 					require('fs'),
	del = 				require('del'),
	semver =			require('semver'),
	exec =				require('child_process').exec,

	config = require('./dev/config.json'), // config
	pkg = require('./package.json'); // package

var args = require('yargs')
						.alias("d", "docs")		.default('d', false)
						.alias("o", "out")		.default('o', './' + config.dirs.defaultOutput)
						.alias("b", "ver")	.default('b', pkg.version)
						.argv; // TODO: document parameters


/* ########################################## */
/* ################ settings ################ */
/* ########################################## */

var options = {
	version: args.ver,
	dodocs: !!args.docs,
	folderOut: args.out,
	folderDocsOut: args.docs.split ? args.docs : './' + config.dirs.defaultDocsOutput
};

var now = new Date();
var replaceVars = {
	variables: {
		"%VERSION%": options.version,
		"%YEAR%": now.getFullYear(),
		"%MONTH%": ("0"+now.getMonth()).slice(-2),
		"%DAY%": ("0"+now.getDate()).slice(-2),
		"%DESCRIPTION%": config.info.description,
	},
	usePrefix: false
};

var banner = {
	regular: fs.readFileSync("dev/src/banner.regular.js", 'utf-8'),
	min: fs.readFileSync("dev/src/banner.min.js", 'utf-8')
};

// log helper
var log = {
	exit : function () {
		gutil.log.apply(gutil, Array.prototype.concat.apply([gutil.colors.red("ERROR:")], arguments));
		process.exit(1);
	},
	warn : function () {
		gutil.log.apply(gutil, Array.prototype.concat.apply([gutil.colors.yellow("WARNING:")], arguments));
	},
	info : function () {
		gutil.log.apply(gutil, Array.prototype.concat.apply([gutil.colors.blue("INFO:")], arguments));
	},
};

/* ########################################## */
/* ############### MAIN TASKS ############### */
/* ########################################## */

gulp.task('default', ['validateoptions', 'lintsource', 'updatejsonfiles', 'updatereadme', 'build'], function () {
	if (options.version != pkg.version) {
		log.info("Updated to version", options.version);
	}
});

gulp.task('validateoptions', function() {
	// version
	if (!semver.valid(options.version)) {
		log.exit("Invalid version number supplied");
	} else if (semver.lt(options.version, pkg.version)) {
		log.exit("Supplied version (" + options.version + ") is older than current (" + pkg.version + "), defined in package.json");
	}
	// output
	if (!fs.existsSync(options.folderOut)) {
		log.exit("Supplied output path not found.");
	}
	// docs output
	if (options.dodocs && !fs.existsSync(options.folderDocsOut)) {
		log.exit("Supplied output path for docs not found.");
	}
});

gulp.task('clean', function(callback) {
	var toclear = [options.folderOut];
	if (options.dodocs) {
		toclear.push(options.folderDocsOut);
	}
	del(toclear, callback);
});

gulp.task('build', ['clean'], function(callback) {
	var filterMainFile = gulpFilter('core.js');

  var uncompressed = gulp.src(config.files, { base: config.dirs.source })
    .pipe(include("// ")) // do file inclusions
		.pipe(filterMainFile)
    	.pipe(rename("ScrollMagic.js"))
		.pipe(filterMainFile.restore());

	var minified = uncompressed.pipe(clone())
		.pipe(rename({suffix: ".min"}))
		.pipe(replace({
			patterns: [
				{ // remove log messages
					match: /\s*log\([0-3],.+;.*$/gm,
					replacement: ""
				},
				{ // remove unnecessary stuff in minify
					match: /\/\/ \(BUILD\) - REMOVE IN MINIFY - START[^]*?\/\/ \(BUILD\) - REMOVE IN MINIFY - END/gm,
					replacement: ""
				}
			]
		}))
    .pipe(uglify())
    .pipe(concat.header(banner.min + "\n"))
		.pipe(replace(replaceVars))
    .pipe(gulp.dest(options.folderOut + "/minified"));

	 uncompressed.pipe(replace({
				patterns: [
					{ // remove build notes
						match: /[\t ]*\/\/ \(BUILD\).*$\r?\n?/gm,
						replacement: ''
					}
				]
			}))
			// .pipe(rename(function(path){console.log(path);}))
      .pipe(concat.header(banner.regular + "\n")) // have header vars already replaced
			.pipe(replace(replaceVars))
      .pipe(gulp.dest(options.folderOut + "/uncompressed"));

	if (options.dodocs) {
  	log.info("Generating new docs");

	  // gulp-jsdoc only works with jsdoc-alpha5 which sucks.
	 	// 	var jsdocconf = require('./dev/docs/jsdoc.conf.json');
	 	// 	jsdocconf.templates.path = 'dev/docs/template';
	 	// 	uncompressed
	  //   	.pipe(addsrc('./README.md'))
	  //   	.pipe(jsdoc(
	  //   		options.folderDocsOut,
	  //   		jsdocconf.templates,
	  //   			{
	  //   				plugins: jsdocconf.plugins
	  //   			}
	  //   		));

		// gulp jsdoc doesnt work properly, so do it manually
		var
			bin = '"' + 'node_modules/.bin/jsdoc' + '"',
			docIn = '"' + 'README.md' + '"',
			docOut = '-d "' + options.folderDocsOut + '"',
			conf = '-c "' + './dev/docs/jsdoc.conf.json' + '"',
			template = '-t "' + './dev/docs/template' + '"';
		uncompressed
      .pipe(gutil.buffer(function(err, files){
      	files.forEach(function (file) {
      		docIn += ' "' + file.path + '"';
      	});
  		}));
		setTimeout(function(){ // etwas dirty mit timeout, aber wenigstens funktionierts...
  		// console.log(docIn);
			var cmd = [bin, docIn, conf, template, docOut].join(" ");
			// console.log(cmd);
			exec(cmd,
			  function (error, stdout, stderr) {
			    // log.info('stdout: ' + stdout);
			    // log.info('stderr: ' + stderr);
			    if (error !== null) {
			      log.exit('exec error: ' + error);
			    }
				}
			)
			.on("close", callback);
		}, 500);
	} else {
		callback();
	}

});

gulp.task('lintsource', function() {
  var x = gulp.src(config.dirs.source + "/**/*.js")
    .pipe(jshint())
  	.pipe(jshint.reporter('default')); // TODO: custom reporter
});

gulp.task('updatejsonfiles', function() {
	gulp.src(["./package.json", "./bower.json", "./ScrollMagic.jquery.json"])
			.pipe(jeditor(config.info, {keep_array_indentation: true}))
			.pipe(jeditor({version: options.version}, {keep_array_indentation: true}))
			.pipe(gulp.dest("./"));
});

gulp.task('updatereadme', function() {
	gulp.src("./README.md")
			.pipe(replace({
				patterns: [
					{
						match: /(<a .*class='version'.*>v)\d+\.\d+\.\d+(<\/a>)/gi,
						replacement: "$1" + options.version + "$2"
					}
				]
			}))
			.pipe(gulp.dest("./"));
});

gulp.task('openindex', function() { // just open the index file
	var open = require("gulp-open");
  gulp.src("./index.html")
  .pipe(open("<%file.path%>"));
});