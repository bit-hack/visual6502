
var frame, chipbg, overlay, hilite, hitbuffer, ctx;
var nodes = new Array();
var transistors = {};
var nodenamelist=[];

var ngnd = nodenames['vss'];
var npwr = nodenames['vcc'];

var chipLayoutIsVisible = true;  // only modified in expert mode

var ctrace = false;
var traceTheseNodes = [];
var traceTheseTransistors = [];
var loglevel = 0;
var recalclist = new Array();
var recalcHash = new Array();
var group = new Array();

var prevHzTimeStamp=0;
var prevHzCycleCount=0;
var prevHzEstimate1=1;
var prevHzEstimate2=1;
var HzSamplingRate=10;
var logbox;
var logboxAppend=true;

var centerx=300, centery=300;
var zoom=1;
var dragMouseX, dragMouseY, moved;
var statbox;
var findThese;
var labelThese=[];

var highlightThese;

var consolegetc;    // global variable to hold last keypress in the console area
var consolebox;

var chipsurround;

var traceChecksum='';
var goldenChecksum;

var table;
var selected;

// Some constants for the graphics presentation
// the canvas is embedded in an 800x600 clipping div
//   which gives rise to some of the 300 and 400 values in the code
//   there are also some 600 values
// the 6502D chip coords are in the box (216,179) to (8983,9807)
// we have 4 canvases all the same size, now 2000 pixels square
//   chip background - the layout
//   overlay - a red/white transparency to show logic high or low
//   hilite - to show the selected polygon
//   hitbuffer - abusing color values to return which polygon is under a point
// we no longer use a scaling transform - we now scale the chip data at 
//   the point of drawing line segments
// if the canvas is any smaller than chip coordinates there will be
//   rounding artifacts, and at high zoom there will be anti-aliasing on edges.
var grMaxZoom=12;
var grChipSize=10000;
var grCanvasSize=2000;
var grLineWidth=1;

// Index of layerNames corresponds to index into drawLayers
var layernames = ['metal', 'switched diffusion', 'inputdiode', 'grounded diffusion', 'powered diffusion', 'polysilicon'];
var colors = ['rgba(128,128,192,0.4)','#FFFF00','#FF00FF','#4DFF4D',
              '#FF4D4D','#801AC0','rgba(128,0,255,0.75)'];
var drawlayers = [true, true, true, true, true, true];
              
// some modes and parameters which can be passed in from the URL query
var moveHereFirst;
var expertMode=true;
var animateChipLayout = true;
var userCode=[];
var userResetLow;
var userResetHigh;
var headlessSteps=1000;
var noSimulation=false;
var testprogram=[];
var testprogramAddress;

var memory = Array();
var cycle = 0;
var trace = Array();
var logstream = Array();
var running = false;
var logThese=[];
var presetLogLists=[
		['cycle'],
		['ab','db','rw','Fetch','pc','a','x','y','s','p'],
		['Execute','State'],
		['ir','tcstate','-pd'],
		['adl','adh','sb','alu'],
		['alucin','alua','alub','alucout','aluvout','dasb'],
		['plaOutputs','DPControl'],
		['idb','dor'],
		['irq','nmi','res'],
	];

// triggers for breakpoints, watchpoints, input pin events
// almost always are undefined when tested, so minimal impact on performance
clockTriggers={};
writeTriggers={};
readTriggers={};
fetchTriggers={};

// example instruction tracing triggers
// fetchTriggers[0x20]="console.log('0x'+readAddressBus().toString(16)+': JSR');";
// fetchTriggers[0x60]="console.log('0x'+readAddressBus().toString(16)+': RTS');";
// fetchTriggers[0x4c]="console.log('0x'+readAddressBus().toString(16)+': JMP');";

    
// ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ----
// ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ----
        
function setupNodes(){
	for(var i in segdefs){
		var seg = segdefs[i];
		var w = seg[0];
		if(nodes[w]==undefined) 
			nodes[w] = {segs: new Array(), num: w, pullup: seg[1]=='+',
			            state: false, gates: new Array(), c1c2s: new Array()};
		if(w==ngnd) continue;
		if(w==npwr) continue;
		nodes[w].segs.push(seg.slice(3));
	}
}

function setupTransistors(){
	for(i in transdefs){
		var tdef = transdefs[i];
		var name = tdef[0];
		var gate = tdef[1];
		var c1 = tdef[2];
		var c2 = tdef[3];
		var bb = tdef[4];
		if(c1==ngnd) {c1=c2;c2=ngnd;}
		if(c1==npwr) {c1=c2;c2=npwr;}
		var trans = {name: name, on: false, gate: gate, c1: c1, c2: c2, bb: bb};
		nodes[gate].gates.push(trans);
		nodes[c1].c1c2s.push(trans);
		nodes[c2].c1c2s.push(trans);
		transistors[name] = trans;
	}
}

function setupLayerVisibility(){
	var x=document.getElementById('updateShow');
	for (var i=0;i<x.childNodes.length;i++) {
		if(x.childNodes[i].type='checkbox'){
			x.childNodes[i].checked=drawlayers[x.childNodes[i].name];
		}
	}
}

function setupBackground(){
	chipbg = document.getElementById('chipbg');
	chipbg.width = grCanvasSize;
	chipbg.height = grCanvasSize;
	var ctx = chipbg.getContext('2d');
	ctx.fillStyle = '#000000';
	ctx.strokeStyle = 'rgba(255,255,255,0.5)';
	ctx.lineWidth = grLineWidth;
	ctx.fillRect(0,0,grCanvasSize,grCanvasSize);
	for(var i in segdefs){
		var seg = segdefs[i];
		var c = seg[2];
		if (drawlayers[c]) {
			ctx.fillStyle = colors[c];
			drawSeg(ctx, segdefs[i].slice(3));
			ctx.fill();
			if((c==0)||(c==6)) ctx.stroke();
		}
	}		
}

function setupOverlay(){
	overlay = document.getElementById('overlay');
	overlay.width = grCanvasSize;
	overlay.height = grCanvasSize;
	ctx = overlay.getContext('2d');
}

function setupHilite(){
	hilite = document.getElementById('hilite');
	hilite.width = grCanvasSize;
	hilite.height = grCanvasSize;
	var ctx = hilite.getContext('2d');
}

function setupHitBuffer(){
	hitbuffer = document.getElementById('hitbuffer');
	hitbuffer.width = grCanvasSize;
	hitbuffer.height = grCanvasSize;
	hitbuffer.style.visibility = 'hidden';
	var ctx = hitbuffer.getContext('2d');
	for(i in nodes) hitBufferNode(ctx, i, nodes[i].segs);
}

function hitBufferNode(ctx, i, w){
	var low = hexdigit(i&0xf);
	var mid = hexdigit((i>>4)&0xf);
	var high = hexdigit((i>>8)&0xf);
	ctx.fillStyle = '#'+high+'F'+mid+'F'+low+'F';
	for(i in w) {
		drawSeg(ctx, w[i]);
		ctx.fill();
	}
}

function hexdigit(n){
    return '0123456789ABCDEF'.charAt(n);
}

function refresh(){
	if(!chipLayoutIsVisible) return;
	ctx.clearRect(0,0,grCanvasSize,grCanvasSize);
	for(i in nodes){
		if(isNodeHigh(i)) overlayNode(nodes[i].segs);
	}
}

function overlayNode(w){
	ctx.fillStyle = 'rgba(255,0,64,0.4)';
	for(i in w) {
		drawSeg(ctx, w[i]);
		ctx.fill();
	}
}

// originally to highlight using a list of node numbers
//   but can now include transistor names
function hiliteNode(n){
	var ctx = hilite.getContext('2d');
	ctx.clearRect(0,0,grCanvasSize,grCanvasSize);
	if(n==-1) return;

	for(var i in n){
		if(typeof n[i] != "number") {
			hiliteTrans([n[i]]);
			continue;
		}
		if(isNodeHigh(n[i])) {
			ctx.fillStyle = 'rgba(255,0,0,0.7)';
		} else {
			ctx.fillStyle = 'rgba(255,255,255,0.7)';
		}
		var segs = nodes[n[i]].segs;
		for(var s in segs){drawSeg(ctx, segs[s]); ctx.fill();}
	}
}

// highlight a single transistor (additively - does not clear highlighting)
function hiliteTrans(n){
	var ctx = hilite.getContext('2d');
	ctx.strokeStyle = 'rgba(255,255,255,0.7)';
	ctx.lineWidth = 4
	for(var t in n){
		var bb = transistors[n[t]].bb
		var segs = [[bb[0], bb[2], bb[1], bb[2], bb[1], bb[3], bb[0], bb[3]]] 
		for(var s in segs){drawSeg(ctx, segs[s]); ctx.stroke();}
	}
}

function ctxDrawBox(ctx, xMin, yMin, xMax, yMax){
	var cap=ctx.lineCap;
	ctx.lineCap="square";
	ctx.beginPath();
	ctx.moveTo(xMin, yMin);
	ctx.lineTo(xMin, yMax);
	ctx.lineTo(xMax, yMax);
	ctx.lineTo(xMax, yMin);
	ctx.lineTo(xMin, yMin);
	ctx.stroke();
	ctx.lineCap=cap;
}

// takes a bounding box in chip coords and centres the display over it
function zoomToBox(xmin,xmax,ymin,ymax){
	var xmid=(xmin+xmax)/2;
	var ymid=(ymin+ymax)/2;
	var x=(xmid+400)/grChipSize*600;
	var y=600-ymid/grChipSize*600;
	var zoom=5;  // pending a more careful calculation
	moveHere([x,y,zoom]);
}

function drawSeg(ctx, seg){
	var dx = 400;
	ctx.beginPath();
	ctx.moveTo(grScale(seg[0]+dx), grScale(grChipSize-seg[1]));
	for(var i=2;i<seg.length;i+=2) ctx.lineTo(grScale(seg[i]+dx), grScale(grChipSize-seg[i+1]));
	ctx.lineTo(grScale(seg[0]+dx), grScale(grChipSize-seg[1]));
}

function findNodeNumber(x,y){
	var ctx = hitbuffer.getContext('2d');
	var pixels = ctx.getImageData(x*grCanvasSize/600, y*grCanvasSize/600, 2, 2).data;
	if(pixels[0]==0) return -1;
	var high = pixels[0]>>4;
	var mid = pixels[1]>>4;
	var low = pixels[2]>>4;
	return (high<<8)+(mid<<4)+low;
}

function clearHighlight(){
	// remove red/white overlay according to logic value
	// for easier layout navigation
	ctx.clearRect(0,0,grCanvasSize,grCanvasSize);
}

function updateShow(layer, on){
	drawlayers[layer]=on;
	setupBackground();
}

// we draw the chip data scaled down to the canvas
// and so avoid scaling a large canvas
function grScale(x){
	return Math.round(x*grCanvasSize/grChipSize);
}

function localx(el, gx){
	return gx-el.getBoundingClientRect().left;
}

function localy(el, gy){
	return gy-el.getBoundingClientRect().top;
}

function setStatus(){
	var res = '';
	// pad the arguments to make this a three-line display
	// there must be a clean way to do this
	if(arguments[1]==undefined)arguments[1]="";
	if(arguments[2]==undefined)arguments[2]="";
	arguments.length=3;
	for(var i=0;i<arguments.length;i++) res=res+arguments[i]+'<br>';
	statbox.innerHTML = res;
}

function setupNodeNameList(){
	for(var i in nodenames)
		nodenamelist.push(i);
}

function nodeName(n) {
	for(var i in nodenames){
		if(nodenames[i]==n) return i;
	}
	return '';
}

function now(){
    return  new Date().getTime();
}

// try to present a meaningful page before starting expensive work
function setup(){
	statbox = document.getElementById('status');
	setStatus('loading 6502...');
	setTimeout(setup_part2, 0);
}

function setup_part2(){
	frame = document.getElementById('frame');
	statbox = document.getElementById('status');
	// load the circuit before acting on URL parameters
	setupNodes();
	setupTransistors();
	setupParams();
	setupExpertMode();
	detectOldBrowser();
	setStatus('loading graphics...');
	setTimeout(setup_part3, 0);
}

function setup_part3(){
	if(chipLayoutIsVisible){
		// if user requests no chip layout, we can skip all canvas operations
		// which saves a lot of memory and allows us to run on small systems
		updateChipLayoutVisibility(true);
	}
	setStatus('resetting 6502...');
	setTimeout(setup_part4, 0);
}

function setup_part4(){
	setupTable();
	setupNodeNameList();
	logThese=signalSet(loglevel);
	loadProgram();
	setupConsole();
	if(noSimulation){
		stopChip();
		running=undefined;
		setStatus('Ready!');
	} else {
		initChip();
		document.getElementById('stop').style.visibility = 'hidden';
		go();
	}
}

function detectOldBrowser(){
	if(!("getBoundingClientRect" in document.documentElement)){
		// simplify these functions (and adjust layout window position)
		localx=	function(el, gx){
				return gx-el.offsetLeft;
			}
		localy=	function(el, gy){
				return gy-el.offsetTop;
			}
		document.getElementById('plain').style["float"]="right";
		document.getElementById('chip').style.left=0;
		document.getElementById('chip').style.top=0;
		document.getElementById('chip').style.border=0;
	}
}

function setupParams(){
	if(location.search=="")
		return
	var queryParts=location.search.slice(1).split('&');
	var panx;
	var pany;
	var zoom;
	var userAddress;
	for(var i=0;i<queryParts.length;i++){
		var params=queryParts[i].split("=");
		if(params.length!=2){
			if(loglevel>0)
				console.log('malformed parameters',params);
			break;
		}
		var name=params[0];
		var value=params[1].replace(/\/$/,""); // chrome sometimes adds trailing slash
		// be (relatively) forgiving in what we accept
		//
		// user interface mode control
		if(name=="loglevel" && parseInt(value)!=NaN){
			updateLoglevel(value);
		} else if(name=="logmore" && value!=""){
			updateLogList(value);
		} else if(name=="headlesssteps" && parseInt(value)!=NaN){
			headlessSteps=parseInt(value);
		} else if(name=="graphics" && value.indexOf("f")==0){
			updateChipLayoutVisibility(false);
		} else if(name=="canvas" && parseInt(value)!=NaN){
			grCanvasSize=value;
		// suppress simulation (for layout viewing only on slow browsers)
		} else if(name=="nosim" && value.indexOf("t")==0){
			noSimulation=true;
		} else
		// place the graphics window at a point of interest
		if(name=="panx" && parseInt(value)!=NaN){
			panx=parseInt(value);
		} else if(name=="pany" && parseInt(value)!=NaN){
			pany=parseInt(value);
		} else if(name=="zoom" && parseInt(value)!=NaN){
			zoom=parseInt(value);
		} else
		// perform a search, highlight and zoom to object(s)
		if(name=="find" && value.length>0){
			findThese=value;
		} else
		// affix label with optional box to highlight an area of interest
		if(name=="label" && value.length>0){
			labelThese.push(value.split(","));
		} else
		// load a test program: Address, Data and Reset
		if(name=="a" && parseInt(value,16)!=NaN){
			userAddress=parseInt(value,16);
		} else if(name=="d" && value.match(/[0-9a-fA-F]*/)[0].length==value.length){
			for(var j=0;j<value.length;j+=2)
				userCode[userAddress++]=parseInt(value.slice(j,j+2),16);
		} else if(name=="r" && parseInt(value,16)!=NaN){
			userResetLow=parseInt(value,16)%256;
			userResetHigh=(parseInt(value,16)>>8)%256;
		} else
		// setup input pin events, breakpoints, watchpoints
		if(name=="reset0" && parseInt(value)!=NaN){
			clockTriggers[value]="setLow('res');";
		} else if(name=="reset1" && parseInt(value)!=NaN){
			clockTriggers[value]="setHigh('res');";
		} else if(name=="irq0" && parseInt(value)!=NaN){
			clockTriggers[value]="setLow('irq');";
		} else if(name=="irq1" && parseInt(value)!=NaN){
			clockTriggers[value]="setHigh('irq');";
		} else if(name=="nmi0" && parseInt(value)!=NaN){
			clockTriggers[value]="setLow('nmi');";
		} else if(name=="nmi1" && parseInt(value)!=NaN){
			clockTriggers[value]="setHigh('nmi');";
		} else
		// run a test program, and optionally check against a golden checksum
		if(name=="steps" && parseInt(value)!=NaN){
			userSteps=parseInt(value);
			running=true;
		} else if(name=="checksum" && parseInt(value,16)!=NaN){
			goldenChecksum=(0x100000000+parseInt(value,16)).toString(16).slice(-8);
		} else {
			if(loglevel>0)
				console.log('unrecognised parameters:',params);
			break;
		}
	}
	if(panx!=null && pany!=null && zoom!=null)
		moveHereFirst=[panx,pany,zoom];
}

function updateChipLayoutAnimation(isOn){
	// simulation is much faster if we don't update the chip layout on every step
	animateChipLayout=isOn;
	document.getElementById('animateModeCheckbox').checked = animateChipLayout;
}

// these keyboard actions are primarily for the chip display
function handleKey(e){
	var c = e.charCode || e.keyCode;
	c = String.fromCharCode(c);
	if('<>?npZzx'.indexOf(c)==-1) return;
	if((c=='Z'||c=='x'||c=='<') && zoom>1) setZoom(zoom/1.2);
	else if((c=='z'||c=='>') && zoom<grMaxZoom) setZoom(zoom*1.2);
	else if(c=='?') setZoom(1);
	// FIXME these keys are for the simulator (but not when focus is in a textbox)
	else if(c=='n') stepForward();
	else if(c=='p') stepBack();
}

//  handler for mousedown events over chip display
//  must handle click-to-select (and focus), and drag to pan
function mouseDown(e){
	chipsurround.focus();
	e.preventDefault();
	moved=false;	
	dragMouseX = e.clientX;	
	dragMouseY = e.clientY;
	chipsurround.onmousemove = function(e){mouseMove(e)};
	chipsurround.onmouseup = function(e){mouseUp(e)};
}

function mouseMove(e){
	moved = true;
	if(zoom==1) return;
	var dx = e.clientX-dragMouseX;
	var dy = e.clientY-dragMouseY;
	dragMouseX = e.clientX;
	dragMouseY = e.clientY;
	centerx-=dx/zoom;
	centerx = Math.max(centerx, 400/zoom);
	centerx = Math.min(centerx, 600-400/zoom);
	centery-=dy/zoom;
	centery = Math.max(centery, 300/zoom);
	centery = Math.min(centery, 600-300/zoom);
	recenter();
}

function mouseUp(e){
	if(!moved) handleClick(e);	
	chipsurround.onmousemove = undefined;
	chipsurround.onmouseup = undefined;
}

function setZoom(n){
	zoom = n;
	setChipStyle({
		width: 600*n+'px',
		height: 600*n+'px'
	});
	recenter();
}

function recenter(){
	var top = -centery*zoom+300;
	top = Math.min(top, 0);
	top = Math.max(top, -600*(zoom-1));
	var left = -centerx*zoom+400;
	left = Math.min(left, 0);
	left = Math.max(left, (zoom==1)?100:-600*zoom+800);
	setChipStyle({
		top: top+'px',
		left: left+'px',
	});
	updateLinkHere();
}

function updateLinkHere(){
	var target = location.pathname + "?nosim=t&";
	var findlist = document.getElementById('HighlightThese').value.split(/[\s,]+/).join(",");
	if (findlist != "")
		target = target + "find=" + findlist + "&";
	target = target + whereAmIAsQuery();
	document.getElementById('linkHere').href=target;
}

// place a text label on the highlight layer
// with an optional box around an area of interest
// coordinates used are those reported by a click
// for example:
//   boxLabel(['PD',   50, 8424, 3536, 9256, 2464])
//   boxLabel(['IR',   50, 8432, 2332, 9124,  984])
//   boxLabel(['PLA', 100, 1169, 2328, 8393,  934])
//   boxLabel(['Y',    50, 2143, 8820, 2317, 5689])  
//   boxLabel(['X',    50, 2317, 8820, 2490, 5689])  
//   boxLabel(['S',    50, 2490, 8820, 2814, 5689])
//   boxLabel(['ALU',  50, 2814, 8820, 4525, 5689])
//   boxLabel(['DAdj', 40, 4525, 8820, 5040, 5689])
//   boxLabel(['A',    50, 5040, 8820, 5328, 5689])
//   boxLabel(['PC',   50, 5559, 8820, 6819, 5689])
//   boxLabel(['ID',   50, 7365, 8820, 7676, 5689])
//   boxLabel(['TimC', 40,  600, 1926, 1174,  604])

function flashBoxLabel(args) {
	clearHighlight();
	var callBack = function(){boxLabel(args);};
	setTimeout(callBack, 400);
	setTimeout(clearHighlight,  800);
	setTimeout(callBack, 1200);
}

function boxLabel(args) {
	var text = args[0];
	var textsize = args[1];
	var thickness = 1+ textsize / 20;
	var boxXmin = args[2] * grCanvasSize / grChipSize;
	var boxYmin = args[3] * grCanvasSize / grChipSize;
	var boxXmax = args[4] * grCanvasSize / grChipSize;
	var boxYmax = args[5] * grCanvasSize / grChipSize;
	ctx.lineWidth   = thickness;
	ctx.font        = textsize + 'px sans-serif';
	ctx.fillStyle   = '#ff0';  // yellow
	ctx.fillStyle   = '#f8f';  // magenta
	ctx.fillStyle   = '#fff';  // white
	ctx.strokeStyle = '#fff';  // white
	if(args.length>4){
		ctxDrawBox(ctx, boxXmin, boxYmin, boxXmax, boxYmax);
		// offset the text label to the interior of the box
		boxYmin -= thickness * 2;
	}
	ctx.strokeStyle = '#fff';  // white
	ctx.strokeStyle = '#000';  // black
	ctx.lineWidth   = thickness*2;
	ctx.strokeText(text, boxXmin, boxYmin);
	ctx.fillText(text, boxXmin, boxYmin);
}

// flash some set of nodes according to user input
// also zoom to fit those nodes (not presently optional)
function hiliteNodeList(){
	var tmplist = document.getElementById('HighlightThese').value.split(/[\s,]+/);
	if(tmplist.join("").length==0){
		// request to highlight nothing, so switch off any signal highlighting
		hiliteNode(-1);
		return;
	}
	highlightThese = [];
	var seglist=[];
	var report="";
	for(var i=0;i<tmplist.length;i++){
		// get a node number from a signal name or a node number
		var name = tmplist[i];
		var value = parseInt(tmplist[i]);
		if((value!=NaN) && (typeof nodes[value] != "undefined")) {
			highlightThese.push(value);
			report="node: " + value + ' ' + nodeName(value);
			for(var s in nodes[value].segs)
				seglist.push(nodes[value].segs[s]);
		} else if(typeof nodenames[name] != "undefined") {
			highlightThese.push(nodenames[name]);
			report="node: " + nodenames[name] + ' ' + name;
			for(var s in nodes[nodenames[name]].segs)
				seglist.push(nodes[nodenames[name]].segs[s]);
		} else if(typeof transistors[name] != "undefined") {
			// normally we push numbers: a non-number is a transistor name
			highlightThese.push(name);
			report="transistor: " + name;
			seglist.push([
				transistors[name].bb[0],transistors[name].bb[2],
				transistors[name].bb[1],transistors[name].bb[3]
			]);
		} else {
			// allow match of underscore-delimited components, so
			// SUMS and dpc17 both match the node dpc17_SUMS
			for(var i in nodenames){
				re=new RegExp("(^" + name + "_|_" + name + "$)");
				if (re.test(i)){
					value = nodenames[i];
					highlightThese.push(value);
					report="node: " + value + ' ' + nodeName(value);
					for(var s in nodes[value].segs)
						seglist.push(nodes[value].segs[s]);
					break;
				}
			}
		}
	}
	if(highlightThese.length==0){
		setStatus('Find: nothing found!','(Enter a list of nodenumbers, names or transistor names)');
		return;
	} else if (highlightThese.length==1){
		setStatus('Find results:',report);
	} else {
		setStatus('Find: multiple objects found','(' + highlightThese.length + ' objects)');
	}
	var xmin=seglist[0][0], xmax=seglist[0][0];
	var ymin=seglist[0][1], ymax=seglist[0][1];
	for(var s in seglist){
		for(var i=0;i<seglist[s].length;i+=2){
			if(seglist[s][i]<xmin) xmin=seglist[s][i];
			if(seglist[s][i]>xmax) xmax=seglist[s][i];
			if(seglist[s][i+1]<ymin) ymin=seglist[s][i+1];
			if(seglist[s][i+1]>ymax) ymax=seglist[s][i+1];
		}
	}
	zoomToBox(xmin,xmax,ymin,ymax);
	updateLinkHere();
	clearHighlight();  // nullify the simulation overlay (orange/purple)
	hiliteNode(-1);    // unhighlight all nodes
	setTimeout("hiliteNode(highlightThese);", 400);
	setTimeout("hiliteNode(-1);", 800);
	setTimeout("hiliteNode(highlightThese);", 1200);
}

// some notes on coordinates:
// the localx and localy functions return canvas coordinate offsets from the canvas window top left corner
// we divide the results by 'zoom' to get drawn coordinates useful in findNodeNumber
// to convert to reported user chip coordinates we multiply by grChipSize/600
// to compare to segdefs and transdefs coordinates we subtract 400 from x and subtract y from grChipSize

function handleClick(e){
	var x = localx(hilite, e.clientX)/zoom;
	var y = localy(hilite, e.clientY)/zoom;
	var w = findNodeNumber(x,y);
	// convert to chip coordinates
	var cx = Math.round(x*grChipSize/600);
	var cy = Math.round(y*grChipSize/600);
	// prepare two lines of status report
	var s1='x: ' + cx + ' y: ' + cy;
	var s2='node:&nbsp;' + w + '&nbsp;' + nodeName(w);
	if(w==-1) {
		setStatus(s1); // no node found, so report only coordinates
		return;
	}
	// we have a node, but maybe we clicked over a transistor
	var nodelist=[w];
	// match the coordinate against transistor gate bounding boxes
	x=cx-400;
	y=grChipSize-cy;
	for(var i=0;i<nodes[w].gates.length;i++){
		var xmin=nodes[w].gates[i].bb[0], xmax=nodes[w].gates[i].bb[1];
		var ymin=nodes[w].gates[i].bb[2], ymax=nodes[w].gates[i].bb[3];
		if((x >= xmin) && (x <= xmax) && (y >= ymin) && (y <= ymax)){
			// only one match at most, so we replace rather than push
			nodelist=[nodes[w].gates[i].name];
			s2='transistor: ' + nodes[w].gates[i].name + ' on ' + s2;
		}
	}
	// if this is a shift-click, just find and highlight the pass-connected group
	// and list the nodes (or nodenames, preferably)
	if(e.shiftKey) {
		getNodeGroup(w);
		nodelist = group;
		s2 = "nodegroup from&nbsp;" + s2 +
			" (nodes:&nbsp;" +
				group.map(function(x){return nodeName(x)?nodeName(x):x;}).join(",") +
			")";
	}
	hiliteNode(nodelist);
	setStatus(s1, s2);
	if(ctrace) console.log(s1, s2);
}

function updateLoglevel(value){
	loglevel = value;
	logThese = signalSet(loglevel);
	initLogbox(logThese);
}

function setupExpertMode(isOn){
	document.getElementById('expertControlPanel').style.display = 'block';
	if(loglevel==0)
		updateLoglevel(1);
	if(chipLayoutIsVisible)
		document.getElementById('layoutControlPanel').style.display = 'block';
}

function setupConsole(){
	consolebox=document.getElementById('consolebox');
	consolebox.onkeypress=function(e){consolegetc=e.charCode || e.keyCode;};
}

function updateChipLayoutVisibility(isOn){
	chipLayoutIsVisible=isOn;
	if(chipLayoutIsVisible) {
		updateChipLayoutAnimation(true);
		// resize the two panes appropriately
		$("#frame").trigger("resize", [ 810 ]);
		$("#rightcolumn").trigger("resize", [ 738 - 180 ]);
		// replace the Show Chip button with the chip graphics
		chipsurround=document.getElementById('chipsurround');
		chipsurround.style.display = 'block';
		document.getElementById('layoutControlPanel').style.display = 'block';
		document.getElementById('nochip').style.display = 'none';
		// allow the browser to respond while we load the graphics
		setStatus('loading graphics...');
		setTimeout(setupChipLayoutGraphics, 0);
	} else {
		// cannot animate the layout if there is no canvas
		updateChipLayoutAnimation(false);
		// resize the two panes appropriately
		$("#frame").trigger("resize", [ 120 ]);
		$("#rightcolumn").trigger("resize", [ 200 ]);
		// replace the layout display with a button to show it
		document.getElementById('chipsurround').style.display = 'none';
		document.getElementById('layoutControlPanel').style.display = 'none';
		document.getElementById('nochip').style.display = 'block';
	}
}

function setupChipLayoutGraphics(){
	setupLayerVisibility();
	setupBackground();
	setupOverlay();
	setupHilite();
	setupHitBuffer();
	recenter();
	refresh();
	document.getElementById('waiting').style.display = 'none';
	setStatus('Ready!');  // would prefer chipStatus but it's not idempotent
	// pre-fill the Find box if parameters supplied
	if(typeof findThese != "undefined") {
		document.getElementById('HighlightThese').value = findThese;
		hiliteNodeList(); // will pan and zoom to fit
	}
	// pre-pan and zoom if requested (will override any zoom-to-fit by hiliteNodeList)
	if(moveHereFirst!=null)
		moveHere(moveHereFirst);
	// draw any URL-requested labels and boxes
	if(labelThese.length>0) {
		for(var i=0;i<labelThese.length;i+=1)
			flashBoxLabel(labelThese[i]);
	}
	// grant focus to the chip display to enable zoom keys
	chipsurround.focus();
	chipsurround.onmousedown = function(e){mouseDown(e);};
	chipsurround.onkeypress = function(e){handleKey(e);};
}

// utility function to save graphics pan and zoom
function whereAmIAsQuery(){
	var w=whereAmI();
	return "panx="+w[0].toFixed(1)+"&pany="+w[1].toFixed(1)+"&zoom="+w[2].toFixed(1);
}
function whereAmI(){
	return [centerx, centery, zoom];
}

// restore graphics pan and zoom (perhaps as given in the URL)
function moveHere(place){
	centerx = place[0];
	centery = place[1];
	setZoom(place[2]);
}

function setChipStyle(props){
	for(var i in props){
		chipbg.style[i] = props[i];
		overlay.style[i] = props[i];
		hilite.style[i] = props[i];
		hitbuffer.style[i] = props[i];
	}
}

function recalcNodeList(list){
	var n = list[0];
	recalclist = new Array();
	recalcHash = new Array();
	for(var j=0;j<100;j++){		// loop limiter
		if(list.length==0) return;
		if(ctrace) {
			var i;
			for(i=0;i<traceTheseNodes.length;i++) {
				if(list.indexOf(traceTheseNodes[i])!=-1) break;
			}
			if((traceTheseNodes.length==0)||(list.indexOf(traceTheseNodes[i])==-1)) {
				console.log('recalcNodeList iteration: ', j, list.length, 'nodes');
			} else {
				console.log('recalcNodeList iteration: ', j, list.length, 'nodes', list);
			}
		}
		list.forEach(recalcNode);
		list = recalclist;
		recalclist = new Array();
		recalcHash = new Array();
	}
	if(ctrace) console.log(n,'looping...');
}

function recalcNode(node){
	if(node==ngnd) return;
	if(node==npwr) return;
	getNodeGroup(node);
	var newState = getNodeValue();
	if(ctrace && (traceTheseNodes.indexOf(node)!=-1))
		console.log('recalc', node, group);
	group.forEach(function(i){
		var n = nodes[i];
		if(n.state==newState) return;
		n.state = newState;
		n.gates.forEach(function(t){
			if(n.state) turnTransistorOn(t);
			else turnTransistorOff(t);});
	});
}

function turnTransistorOn(t){
	if(t.on) return;
	if(ctrace && (traceTheseTransistors.indexOf(t.name)!=-1))
		console.log(t.name, 'on', t.gate, t.c1, t.c2);
	t.on = true;
	addRecalcNode(t.c1);
}

function turnTransistorOff(t){
	if(!t.on) return;
	if(ctrace && (traceTheseTransistors.indexOf(t.name)!=-1))
		console.log(t.name, 'off', t.gate, t.c1, t.c2);
	t.on = false;
	addRecalcNode(t.c1);
	addRecalcNode(t.c2);
}

function addRecalcNode(nn){
       if(nn==ngnd) return;
       if(nn==npwr) return;
       if(recalcHash[nn] == 1)return; 
       recalclist.push(nn);
       recalcHash[nn] = 1;
}

function getNodeGroup(i){
	group = new Array();
	addNodeToGroup(i);
}

function addNodeToGroup(i){
	if(group.indexOf(i) != -1) return;
	group.push(i);
	if(i==ngnd) return;
	if(i==npwr) return;
	nodes[i].c1c2s.forEach(
		function(t){
			if(!t.on) return;
			var other;
			if(t.c1==i) other=t.c2;
			if(t.c2==i) other=t.c1;
			addNodeToGroup(other);});
}

function getNodeValue(){
	if(arrayContains(group, ngnd)) return false;
	if(arrayContains(group, npwr)) return true;
	for(var i in group){
		var nn = group[i];
		var n = nodes[nn];
		if(n.pullup) return true;
		if(n.pulldown) return false;
		if(n.state) return true;
	}
	return false;
}

function isNodeHigh(nn){
	return(nodes[nn].state);
}

function saveString(name, str){
	var request = new XMLHttpRequest();
	request.onreadystatechange=function(){};
	request.open('PUT', 'save.php?name='+name, true);
	request.setRequestHeader('Content-Type', 'text/plain');
	request.send(str);
}

function allNodes(){
	var res = new Array();
	var ii = 0;
	for(var i in nodes) {
		// Don't feed numeric strings to recalcNodeList(). Numeric
		// strings can cause a (data dependent) duplicate node number
		// hiccup when accumulating a node group's list, ie:
		// group => [ "49", 483, 49 ]
		ii = Number( i );
		if((ii!=npwr)&&(ii!=ngnd)) res.push(ii);
	}
	return res;
}

function stateString(){
	var codes = ['l','h'];
	var res = '';
	for(var i=0;i<1725;i++){
		var n = nodes[i];
		if(n==undefined) res+='x';
		else if(i==ngnd) res+='g';
		else if(i==npwr) res+='v';
		else res+= codes[0+n.state];
	}
	return res;
}

function showState(str){
	var codes = {g: false, h: true, v: true, l: false};
	for(var i=0;i<str.length;i++){
		if(str[i]=='x') continue;
		var state = codes[str[i]];
		nodes[i].state = state;
		var gates = nodes[i].gates;
		gates.forEach(function(t){t.on=state;});
	}
	refresh();
}

function setPd(name){
	var nn = nodenames[name];
	nodes[nn].pullup = false;
	nodes[nn].pulldown = true;
}

function setHigh(name){
	var nn = nodenames[name];
	nodes[nn].pullup = true;
	nodes[nn].pulldown = false;
	recalcNodeList([nn]);
}

function setLow(name){
	var nn = nodenames[name];
	nodes[nn].pullup = false;
	nodes[nn].pulldown = true;
	recalcNodeList([nn]);
}

function arrayContains(arr, el){
    return arr.indexOf(el)!=-1;
}

function setupTable(){
	table = document.getElementById('memtable');
	for(var r=0;r<32;r++){
		var row = document.createElement('tr');
		table.appendChild(row);
		var col = document.createElement('td');
		col.appendChild(document.createTextNode(hexWord(r*16)+':'));
		col.onmousedown = unselectCell;
		row.appendChild(col);
		for(var c=0;c<16;c++){
			col = document.createElement('td');
			col.addr = r*16+c;
			col.val = 0;
			col.onmousedown = function(e){handleCellClick(e);};
			col.appendChild(document.createTextNode('00'));
			row.appendChild(col);
		}
	}
}

function handleCellClick(e){
	var c = e.target;
	selectCell(c.addr);
}

function cellKeydown(e){
	var c = e.keyCode;
	if(c==13) unselectCell();
	else if(c==32) selectCell((selected+1)%0x200);
	else if(c==8) selectCell((selected+0x1ff)%0x200);
	else if((c>=48)&&(c<58)) setCellValue(selected, getCellValue(selected)*16+c-48);
	else if((c>=65)&&(c<71)) setCellValue(selected, getCellValue(selected)*16+c-55);
	mWrite(selected, getCellValue(selected));
}

function setCellValue(n, val){
	if(val==undefined)
		val=0x00;
	val%=256;
	cellEl(n).val=val;
	cellEl(n).innerHTML=hexByte(val);
}

function getCellValue(n){
    return cellEl(n).val;
}

function selectCell(n){
	unselectCell();
	if(n>=0x200) return;
	cellEl(n).style.background = '#ff8';
	selected = n;
	table.onkeydown = function(e){cellKeydown(e);};
}

function unselectCell(){
	if(selected==undefined) return;
	cellEl(selected).style.background = '#fff';
	selected = undefined;
	window.onkeydown = undefined;
}

function cellEl(n){
	var r = n>>4;
	var c = n%16;
	var e = table.childNodes[r].childNodes[c+1];
	return e;
}

function loadProgram(){
	// a moderate size of static testprogram might be loaded
	if(testprogram.length!=0 && testprogramAddress != undefined)
		for(var i=0;testprogram[i]!=undefined;i++){
			var a=testprogramAddress+i;
			mWrite(a, testprogram[i]);
			if(a<0x200)
				setCellValue(a, testprogram[i]);
		}
	// a small test program or patch might be passed in the URL
	if(userCode.length!=0)
		for(var i=0;i<userCode.length;i++){
			if(userCode[i] != undefined){
				mWrite(i, userCode[i]);
				if(i<0x200)
					setCellValue(i, userCode[i]);
			}
		}
	// default reset vector will be 0x0000 because undefined memory reads as zero
	if(userResetLow!=undefined)
		mWrite(0xfffc, userResetLow);
	if(userResetHigh!=undefined)
		mWrite(0xfffd, userResetHigh);
}

function go(){
	if(typeof userSteps != "undefined"){
		if(--userSteps==0){
			running=false;
			userSteps=undefined;
		}
	}
	if(running) {
           step();
	   setTimeout(go, 0); // schedule the next poll
        }
}

function goUntilSync(){
	halfStep();
	while(!isNodeHigh(nodenames['sync']) || isNodeHigh(nodenames['clk0']))
		halfStep();
}

function goUntilSyncOrWrite(){
	halfStep();
	cycle++;
	while(
		!isNodeHigh(nodenames['clk0']) ||
		( !isNodeHigh(nodenames['sync']) && isNodeHigh(nodenames['rw']) )
	) {
		halfStep();
		cycle++;
	}
	chipStatus();
}

function testNMI(n){
        initChip();

        mWrite(0x0000, 0x38); // set carry
        mWrite(0x0001, 0x4c); // jump to test code
        mWrite(0x0002, 0x06);
        mWrite(0x0003, 0x23);

        mWrite(0x22ff, 0x38); // set carry
        mWrite(0x2300, 0xea);
        mWrite(0x2301, 0xea);
        mWrite(0x2302, 0xea);
        mWrite(0x2303, 0xea);
        mWrite(0x2304, 0xb0); // branch carry set to self
        mWrite(0x2305, 0xfe);

        mWrite(0x2306, 0xb0); // branch carry set to self
        mWrite(0x2307, 0x01);
        mWrite(0x2308, 0x00); // brk should be skipped
        mWrite(0x2309, 0xa9); // anything
        mWrite(0x230a, 0xde); // anything
        mWrite(0x230b, 0xb0); // branch back with page crossing
        mWrite(0x230c, 0xf2);

        mWrite(0xc018, 0x40); // nmi handler

        mWrite(0xfffa, 0x18); // nmi vector
        mWrite(0xfffb, 0xc0);
        mWrite(0xfffc, 0x00); // reset vector
        mWrite(0xfffd, 0x00);

        for(var i=0;i<n;i++){
            step();
        }
        setLow('nmi');
        chipStatus();
        for(var i=0;i<8;i++){
            step();
        }
        setHigh('nmi');
        chipStatus();
        for(var i=0;i<16;i++){
            step();
        }
}

function initChip(){
    var start = now();
	for(var nn in nodes) {
		nodes[nn].state = false;
		nodes[nn].float = true;
	}
	nodes[ngnd].state = false;
	nodes[ngnd].float = false;
	nodes[npwr].state = true;
	nodes[npwr].float = false;
	for(var tn in transistors)
        transistors[tn].on = false;
	setLow('res');
	setLow('clk0');
	setHigh('rdy'); setLow('so');
	setHigh('irq'); setHigh('nmi');
	recalcNodeList(allNodes()); 
	for(var i=0;i<8;i++){
        setHigh('clk0'), setLow('clk0');
    }
	setHigh('res');
    // avoid updating graphics and trace buffer before user code
	for(var i=0;i<18;i++){
        halfStep();
    }
	refresh();
	cycle = 0;
	trace = Array();
	if(typeof expertMode != "undefined")
		updateLogList();
	chipStatus();
	if(ctrace)
        console.log('initChip done after', now()-start);
}

function signalSet(n){
	var signals=[];
	for (var i=0; (i<=n)&&(i<presetLogLists.length) ; i++){
		for (var j=0; j<presetLogLists[i].length; j++){
			signals.push(presetLogLists[i][j]);
		}
	}
	return signals;
}

function updateLogList(names){
	// user supplied a list of signals, which we append to the set defined by loglevel
	logThese = signalSet(loglevel);
	if(typeof names == "undefined")
		// this is a UI call - read the text input
		names = document.getElementById('LogThese').value;
	else
		// this is an URL call - update the text input box
		document.getElementById('LogThese').value = names;
	names = names.split(/[\s,]+/);
	for(var i=0;i<names.length;i++){
		// could be a signal name, a node number, or a special name
		if(typeof busToString(names[i]) != "undefined")
			logThese.push(names[i]);
	}
	initLogbox(logThese);
}

// simulate a single clock phase, updating trace and highlighting layout
function step(){
	var s=stateString();
	var m=getMem();
	trace[cycle]= {chip: s, mem: m};
	if(goldenChecksum != undefined)
		traceChecksum=adler32(traceChecksum+s+m.slice(0,511).toString(16));
	halfStep();
	if(animateChipLayout)
		refresh();
	cycle++;
	chipStatus();
}

// simulate a single clock phase with no update to graphics or trace
function halfStep(){
	var clk = isNodeHigh(nodenames['clk0']);
	eval(clockTriggers[cycle]);
	if (clk) {setLow('clk0'); handleBusRead(); } 
	else {setHigh('clk0'); handleBusWrite();}
}

function handleBusRead(){
	if(isNodeHigh(nodenames['rw'])){
		var a = readAddressBus();
		var d = eval(readTriggers[a]);
		if(d == undefined)
			d = mRead(readAddressBus());
		if(isNodeHigh(nodenames['sync']))
			eval(fetchTriggers[d]);
		writeDataBus(d);
	}
}

function handleBusWrite(){
	if(!isNodeHigh(nodenames['rw'])){
		var a = readAddressBus();
		var d = readDataBus();
		eval(writeTriggers[a]);
		mWrite(a,d);
		if(a<0x200) setCellValue(a,d);
	}
}

function readAddressBus(){
    return readBits('ab', 16);
}

function readDataBus(){
    return readBits('db', 8);
}

function readA(){
    return readBits('a', 8);
}

function readY(){
    return readBits('y', 8);
}

function readX(){
    return readBits('x', 8);
}

function readP(){
    return readBits('p', 8);
}

function readPstring(){
   var result;
   result = (isNodeHigh(nodenames['p7'])?'N':'n') +
            (isNodeHigh(nodenames['p6'])?'V':'v') +
            '&#8209' +  // non-breaking hyphen
            (isNodeHigh(nodenames['p4'])?'B':'b') +
            (isNodeHigh(nodenames['p3'])?'D':'d') +
            (isNodeHigh(nodenames['p2'])?'I':'i') +
            (isNodeHigh(nodenames['p1'])?'Z':'z') +
            (isNodeHigh(nodenames['p0'])?'C':'c');
   return result;
}

function readSP(){
    return readBits('s', 8);
}

function readPC(){
    return (readBits('pch', 8)<<8) + readBits('pcl', 8);
}

function readPCL(){
    return readBits('pcl', 8);
}

function readPCH(){
    return readBits('pch', 8);
}

// for one-hot or few-hot signal collections we want to list the active ones
// and for brevity we remove the common prefix
function listActiveSignals(pattern){
	var r=new RegExp(pattern);
	var list=[];
	for(var i in nodenamelist){
		if(r.test(nodenamelist[i])) {
			if(isNodeHigh(nodenames[nodenamelist[i]]))
				// also map hyphen to a non-breaking version
				list.push(nodenamelist[i].replace(r,'').replace(/-/g,'&#8209'));
		}
	}
	return list;
}

// The 6502 TCState is almost but not quite an inverted one-hot shift register
function listActiveTCStates() {
	var s=[];
	if(!isNodeHigh(nodenames['clock1']))	s.push("T0");
	if(!isNodeHigh(nodenames['clock2']))	s.push("T1");
	if(!isNodeHigh(nodenames['t2']))	s.push("T2");
	if(!isNodeHigh(nodenames['t3']))	s.push("T3");
	if(!isNodeHigh(nodenames['t4']))	s.push("T4");
	if(!isNodeHigh(nodenames['t5']))	s.push("T5");
	return s.join("+");
}

// Show all time code node states (active and inactive) in fixed format,
// with T1/T6 indication in square brackets. ".." for a node indicates
// inactive state, "T"* for a node indicates active state.
// For discussion of this reconstruction, see:
// http://visual6502.org/wiki/index.php?title=6502_Timing_States
function allTCStates( useHTML )
{
    var s = "";
    var _spc;
    useHTML = (typeof useHTML === 'undefined') ? false : useHTML;
        // Use Non-Breaking Space for presentation in an HTML (browser)
        // context, else use ASCII space for logging context
    _spc = useHTML ? '&nbsp;' : ' ';
    var allHigh, thisHigh;
    thisHigh = isNodeHigh( nodenames[ 'clock1' ] );
    allHigh = thisHigh;
    if ( !thisHigh ) s += "T0"; else s += "..";
    s += _spc;
        // T+ in visual6502 is called T1x in
        // http://www.weihenstephan.org/~michaste/pagetable/6502/6502.jpg
        // Notated as T+ for compatibility with PLA node names
    thisHigh = isNodeHigh( nodenames[ 'clock2' ] );
    allHigh = allHigh && thisHigh;
    if ( !thisHigh ) s += "T+"; else s += "..";
    s += _spc;
    thisHigh = isNodeHigh( nodenames[ 't2' ] );
    allHigh = allHigh && thisHigh;
    if ( !thisHigh ) s += "T2"; else s += "..";
    s += _spc;
    thisHigh = isNodeHigh( nodenames[ 't3' ] );
    allHigh = allHigh && thisHigh;
    if ( !thisHigh ) s += "T3"; else s += "..";
    s += _spc;
    thisHigh = isNodeHigh( nodenames[ 't4' ] );
    allHigh = allHigh && thisHigh;
    if ( !thisHigh ) s += "T4"; else s += "..";
    s += _spc;
    thisHigh = isNodeHigh( nodenames[ 't5' ] )
    allHigh = allHigh && thisHigh;
    if ( !thisHigh ) s += "T5"; else s += "..";
    s += _spc + "[";
        // If all of the time code bits are high (inactive)...
    if ( allHigh ) {
        // ...distinguish T1 from T6
            // If bits T2 through T5 are actively being cleared...
        if ( isNodeHigh( 1357 ) ) {
            // ...then this is T1
            s += "T1";
        } else {
            // ...else T2 through T5 are clear because the bits ran off the end
            // of the T2 through T5 complex: this is T6
            s += "T6";
        }
    } else {
        s += "..";
    }
    s += "]";
    return s;
}

function readBit(name){
        return isNodeHigh(nodenames[name])?1:0;
}

function readBits(name, n){
	var res = 0;
	for(var i=0;i<n;i++){
		var nn = nodenames[name+i];
		res+=((isNodeHigh(nn))?1:0)<<i;
	}
	return res;
}

function busToString(busname){
	// takes a signal name or prefix
	// returns an appropriate string representation
	// some 'signal names' are CPU-specific aliases to user-friendly string output
	if(busname=='cycle')
		return cycle>>1;
	if(busname=='pc')
		return busToHex('pch') + busToHex('pcl');
	if(busname=='p')
		return readPstring();
	if(busname=='tcstate')
		return ['clock1','clock2','t2','t3','t4','t5'].map(busToHex).join("");
	if(busname=='State')
		return listActiveTCStates();
	if(busname=='TState')
		return allTCStates( true );
	if(busname=='Phi')
		// Pretty-printed phase indication based on the state of cp1,
                // the internal Phase 1 node
		return '&Phi;' +
		       (isNodeHigh( nodenames[ 'cp1' ] ) ? '1' : '2');
	if(busname=='Execute')
		return dis6502toHTML(readBits('ir',8));
	if(busname=='Fetch')
		return isNodeHigh(nodenames['sync'])?dis6502toHTML(readDataBus()):"";
	if(busname=='plaOutputs')
		// PLA outputs are mostly ^op- but some have a prefix too
		//    - we'll allow the x and xx prefix but ignore the #
		return listActiveSignals('^([x]?x-)?op-');
	if(busname=='DPControl')
		return listActiveSignals('^dpc[0-9]+_');
	if(busname[0]=="-"){
		// invert the value of the bus for display
		var value=busToHex(busname.slice(1))
		if(typeof value != "undefined")
			return value.replace(/./g,function(x){return (15-parseInt(x,16)).toString(16)});
		else
			return undefined;;
	} else {
		return busToHex(busname);
	}
}

function busToHex(busname){
	// may be passed a bus or a signal, so allow multiple signals
	var width=0;
	var r=new RegExp('^' + busname + '[0-9]+$');
	for(var i in nodenamelist){
		if(r.test(nodenamelist[i])) {
			width++;
		}
	}
	if(width==0) {
		// not a bus, so could be a signal, a nodenumber or a mistake
		if(typeof nodenames[busname] != "undefined")
			return isNodeHigh(nodenames[busname])?"1":"0";
		if((parseInt(busname)!=NaN) && (typeof nodes[busname] != "undefined"))
			return isNodeHigh(busname)?"1":"0";
		return undefined;
	}
	if(width>16)
		return undefined;
	// finally, convert from logic values to hex
	return (0x10000+readBits(busname,width)).toString(16).slice(-(width-1)/4-1);
}

function writeDataBus(x){
	var recalcs = Array();
	for(var i=0;i<8;i++){
		var nn = nodenames['db'+i];
		var n = nodes[nn];
		if((x%2)==0) {n.pulldown=true; n.pullup=false;}
		else {n.pulldown=false; n.pullup=true;}
		recalcs.push(nn);
		x>>=1;
	}
	recalcNodeList(recalcs);
}

function mRead(a){
	if(memory[a]==undefined) return 0;
	else return memory[a];
}

function mWrite(a, d){
    memory[a]=d;
}

function clkNodes(){
	var res = Array();
	res.push(943);
	for(var i in nodes[943].gates){
		var t = nodes[943].gates[i];
		if(t.c1==npwr) res.push(t.c2);
		if(t.c2==npwr) res.push(t.c1);
	}
	hiliteNode(res);
}

function runChip(){
	var start = document.getElementById('start');
	var stop = document.getElementById('stop');
	start.style.visibility = 'hidden';
	stop.style.visibility = 'visible';
	if(typeof running == "undefined")
		initChip();
	running = true;
        go();
}

function stopChip(){
	var start = document.getElementById('start');
	var stop = document.getElementById('stop');
	start.style.visibility = 'visible';
	stop.style.visibility = 'hidden';
	running = false;
}

function resetChip(){
	stopChip();
        setStatus('resetting 6502...');                          
	setTimeout(initChip,0);
}

function stepForward(){
	if(typeof running == "undefined")
		initChip();
	stopChip();
	step();
}

function stepBack(){
	if(cycle==0) return;
	showState(trace[--cycle].chip);
	setMem(trace[cycle].mem);
	var clk = isNodeHigh(nodenames['clk0']);
	if(!clk) writeDataBus(mRead(readAddressBus()));
	chipStatus();
}

function chipStatus(){
	var ab = readAddressBus();
	var machine1 =
	        ' halfcyc:' + cycle +
	        ' phi0:' + readBit('clk0') +
                ' AB:' + hexWord(ab) +
	        ' D:' + hexByte(readDataBus()) +
	        ' RnW:' + readBit('rw');
	var machine2 =
	        ' PC:' + hexWord(readPC()) +
	        ' A:' + hexByte(readA()) +
	        ' X:' + hexByte(readX()) +
	        ' Y:' + hexByte(readY()) +
	        ' SP:' + hexByte(readSP()) +
	        ' ' + readPstring();
	var machine3 = 
		'Hz: ' + estimatedHz().toFixed(1);
	if(typeof expertMode != "undefined") {
		machine3 += ' Exec: ' + busToString('Execute') + '(' + busToString('State') + ')';
		if(isNodeHigh(nodenames['sync']))
			machine3 += ' (Fetch: ' + busToString('Fetch') + ')';
		if(goldenChecksum != undefined)
			machine3 += " Chk:" + traceChecksum + ((traceChecksum==goldenChecksum)?" OK":" no match");
	}
	setStatus(machine1, machine2, machine3);
	if (loglevel>0) {
		updateLogbox(logThese);
	}
	selectCell(ab);
}

// run for an extended number of cycles, with low overhead, for interactive programs or for benchmarking
//    note: to run an interactive program, use an URL like
//    http://visual6502.org/JSSim/expert.html?graphics=f&loglevel=-1&headlesssteps=-500
function goFor(){
	var n = headlessSteps;  //  a negative value is a request to free-run
	if(headlessSteps<0)
		n=-n;
	var start = document.getElementById('start');
	var stop = document.getElementById('stop');
	start.style.visibility = 'hidden';
	stop.style.visibility = 'visible';
	if(typeof running == "undefined") {
		initChip();
	}
	running = true;
	setTimeout("instantaneousHz(); goForN("+n+")",0);
}

// helper function: allows us to poll 'running' without resetting it when we're re-scheduled
function goForN(n){
	var n2=n;  // save our parameter so we can re-submit ourselves
	while(n--){
		halfStep();
		cycle++;
	}
	instantaneousHz();
	chipStatus();
	if((headlessSteps<0) && running){
		setTimeout("goForN("+n2+")",0); // re-submit ourselves if we are meant to free-run
		return;
	}
	running = false;
	start.style.visibility = 'visible';
	stop.style.visibility = 'hidden';
}

// return an averaged speed: called periodically during normal running
function estimatedHz(){
	if(cycle%HzSamplingRate!=3)
		return prevHzEstimate1;
	var HzTimeStamp = now();
	var HzEstimate = (cycle-prevHzCycleCount+.01)/(HzTimeStamp-prevHzTimeStamp+.01);
	HzEstimate=HzEstimate*1000/2; // convert from phases per millisecond to Hz
	if(HzEstimate<5)
		HzSamplingRate=5;  // quicker
	if(HzEstimate>10)
		HzSamplingRate=10; // smoother
	prevHzEstimate2=prevHzEstimate1;
	prevHzEstimate1=(HzEstimate+prevHzEstimate1+prevHzEstimate2)/3; // wrong way to average speeds
	prevHzTimeStamp=HzTimeStamp;
	prevHzCycleCount=cycle;
	return prevHzEstimate1
}

// return instantaneous speed: called twice, before and after a timed run using goFor()
function instantaneousHz(){
	var HzTimeStamp = now();
	var HzEstimate = (cycle-prevHzCycleCount+.01)/(HzTimeStamp-prevHzTimeStamp+.01);
	HzEstimate=HzEstimate*1000/2; // convert from phases per millisecond to Hz
	prevHzEstimate1=HzEstimate;
	prevHzEstimate2=prevHzEstimate1;
	prevHzTimeStamp=HzTimeStamp;
	prevHzCycleCount=cycle;
	return prevHzEstimate1
}

function initLogbox(names){
	logbox=document.getElementById('logstream');
	if(logbox==null)return;

	names=names.map(function(x){return x.replace(/^-/,'')});
	logStream = [];
	logStream.push("<td class=header>" + names.join("</td><td class=header>") + "</td>");
	logbox.innerHTML = "<tr>"+logStream.join("</tr><tr>")+"</tr>";
}

// can append or prepend new states to the log table
// when we reverse direction we need to reorder the log stream
function updateLogDirection(){
	var loglines=[];
	logboxAppend=!logboxAppend;
	// the first element is the header so we can't reverse()
	for (var i=1;i<logStream.length;i++) {
		loglines.unshift(logStream[i]);
	}
	loglines.unshift(logStream[0]);
	logStream=loglines;
	logbox.innerHTML = "<tr>"+logStream.join("</tr><tr>")+"</tr>";
}

// update the table of signal values, by prepending or appending
function updateLogbox(names){
	var signals=[];
	var odd=true;
	var bg;
	var row;

	for(var i in names){
		if(cycle % 4 < 2){
			bg = odd ? " class=oddcol":"";
		} else {
			bg = odd ? " class=oddrow":" class=oddrowcol";
		}
		signals.push("<td" + bg + ">" + busToString(names[i]) + "</td>");
		odd =! odd;
	}
	row = "<tr>" + signals.join("") + "</tr>";
	if(logboxAppend)
	        logStream.push(row);
	else
		logStream.splice(1,0,row);

	logbox.innerHTML = logStream.join("");
}

function getMem(){
	var res = Array();
	for(var i=0;i<0x200;i++) res.push(mRead(i));
	return res;
}

function setMem(arr){
	for(var i=0;i<0x200;i++){mWrite(i, arr[i]); setCellValue(i, arr[i]);}
}

function hexWord(n){
    return (0x10000+n).toString(16).substring(1)
}
    
function hexByte(n){
    return (0x100+n).toString(16).substring(1)
}

function adler32(x){
	var a=1;
	var b=0;
	for(var i=0;i<x.length;i++){
		a=(a+x.charCodeAt(i))%65521;
		b=(b+a)%65521;
	}
	return (0x100000000+(b<<16)+a).toString(16).slice(-8);
}

// sanitised opcode for HTML output
function dis6502toHTML(byte){
	var opcode=dis6502[byte];
	if(typeof opcode == "undefined")
		return "unknown"
	return opcode.replace(/ /,'&nbsp;');
}

// opcode lookup for 6502 - not quite a disassembly
//   javascript derived from Debugger.java by Achim Breidenbach
var dis6502={
    0x00:"BRK",
    0x01:"ORA (zp,X)",
    0x05:"ORA zp",
    0x06:"ASL zp",
    0x08:"PHP",
    0x09:"ORA #",
    0x0A:"ASL ",
    0x0D:"ORA Abs",
    0x0E:"ASL Abs",
    0x10:"BPL ",
    0x11:"ORA (zp),Y",
    0x15:"ORA zp,X",
    0x16:"ASL zp,X",
    0x18:"CLC",
    0x19:"ORA Abs,Y",
    0x1D:"ORA Abs,X",
    0x1E:"ASL Abs,X",
    0x20:"JSR Abs",
    0x21:"AND (zp,X)",
    0x24:"BIT zp",
    0x25:"AND zp",
    0x26:"ROL zp",
    0x28:"PLP",
    0x29:"AND #",
    0x2A:"ROL ",
    0x2C:"BIT Abs",
    0x2D:"AND Abs",
    0x2E:"ROL Abs",
    0x30:"BMI ",
    0x31:"AND (zp),Y",
    0x35:"AND zp,X",
    0x36:"ROL zp,X",
    0x38:"SEC",
    0x39:"AND Abs,Y",
    0x3D:"AND Abs,X",
    0x3E:"ROL Abs,X",
    0x40:"RTI",
    0x41:"EOR (zp,X)",
    0x45:"EOR zp",
    0x46:"LSR zp",
    0x48:"PHA",
    0x49:"EOR #",
    0x4A:"LSR ",
    0x4C:"JMP Abs",
    0x4D:"EOR Abs",
    0x4E:"LSR Abs",
    0x50:"BVC ",
    0x51:"EOR (zp),Y",
    0x55:"EOR zp,X",
    0x56:"LSR zp,X",
    0x58:"CLI",
    0x59:"EOR Abs,Y",
    0x5D:"EOR Abs,X",
    0x5E:"LSR Abs,X",
    0x60:"RTS",
    0x61:"ADC (zp,X)",
    0x65:"ADC zp",
    0x66:"ROR zp",
    0x68:"PLA",
    0x69:"ADC #",
    0x6A:"ROR ",
    0x6C:"JMP (Abs)",
    0x6D:"ADC Abs",
    0x6E:"ROR Abs",
    0x70:"BVS ",
    0x71:"ADC (zp),Y",
    0x75:"ADC zp,X",
    0x76:"ROR zp,X",
    0x78:"SEI",
    0x79:"ADC Abs,Y",
    0x7D:"ADC Abs,X",
    0x7E:"ROR Abs,X",
    0x81:"STA (zp,X)",
    0x84:"STY zp",
    0x85:"STA zp",
    0x86:"STX zp",
    0x88:"DEY",
    0x8A:"TXA",
    0x8C:"STY Abs",
    0x8D:"STA Abs",
    0x8E:"STX Abs",
    0x90:"BCC ",
    0x91:"STA (zp),Y",
    0x94:"STY zp,X",
    0x95:"STA zp,X",
    0x96:"STX zp,Y",
    0x98:"TYA",
    0x99:"STA Abs,Y",
    0x9A:"TXS",
    0x9D:"STA Abs,X",
    0xA0:"LDY #",
    0xA1:"LDA (zp,X)",
    0xA2:"LDX #",
    0xA4:"LDY zp",
    0xA5:"LDA zp",
    0xA6:"LDX zp",
    0xA8:"TAY",
    0xA9:"LDA #",
    0xAA:"TAX",
    0xAC:"LDY Abs",
    0xAD:"LDA Abs",
    0xAE:"LDX Abs",
    0xB0:"BCS ",
    0xB1:"LDA (zp),Y",
    0xB4:"LDY zp,X",
    0xB5:"LDA zp,X",
    0xB6:"LDX zp,Y",
    0xB8:"CLV",
    0xB9:"LDA Abs,Y",
    0xBA:"TSX",
    0xBC:"LDY Abs,X",
    0xBD:"LDA Abs,X",
    0xBE:"LDX Abs,Y",
    0xC0:"CPY #",
    0xC1:"CMP (zp,X)",
    0xC4:"CPY zp",
    0xC5:"CMP zp",
    0xC6:"DEC zp",
    0xC8:"INY",
    0xC9:"CMP #",
    0xCA:"DEX",
    0xCC:"CPY Abs",
    0xCD:"CMP Abs",
    0xCE:"DEC Abs",
    0xD0:"BNE ",
    0xD1:"CMP (zp),Y",
    0xD5:"CMP zp,X",
    0xD6:"DEC zp,X",
    0xD8:"CLD",
    0xD9:"CMP Abs,Y",
    0xDD:"CMP Abs,X",
    0xDE:"DEC Abs,X",
    0xE0:"CPX #",
    0xE1:"SBC (zp,X)",
    0xE4:"CPX zp",
    0xE5:"SBC zp",
    0xE6:"INC zp",
    0xE8:"INX",
    0xE9:"SBC #",
    0xEA:"NOP",
    0xEC:"CPX Abs",
    0xED:"SBC Abs",
    0xEE:"INC Abs",
    0xF0:"BEQ ",
    0xF1:"SBC (zp),Y",
    0xF5:"SBC zp,X",
    0xF6:"INC zp,X",
    0xF8:"SED",
    0xF9:"SBC Abs,Y",
    0xFD:"SBC Abs,X",
    0xFE:"INC Abs,X",
};

// This file testprogram.js can be substituted by one of several tests
// which may not be redistributable
// for example
//    cbmbasic  loaded at 0xa000 with entry point 0xe394
//    test6502 (by Bird Computer) loaded at 0x8000 with entry point 0x8000
//
// (can use xxd -i to convert binary into C include syntax, as a starting point)
//
testprogramAddress = 0x0000;

// we want to auto-clear the console if any output is sent by the program
var consoleboxStream = "";

// demonstrate write hook
writeTriggers[0x000F] = 
    "consoleboxStream += String.fromCharCode(d);"+
    "consolebox.innerHTML = consoleboxStream;";

// demonstrate read hook (not used by this test program)
readTriggers[0xD011] = "((consolegetc==undefined)?0:0xff)";  // return zero until we have a char
readTriggers[0xD010] = "var c=consolegetc; consolegetc=undefined; (c)";

testprogram = [
	0xa9, 0x00,              // LDA #$00
	0x20, 0x10, 0x00,        // JSR $0010
	0x4c, 0x02, 0x00,        // JMP $0002
	0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x40,
	0xe8,                    // INX
	0x88,                    // DEY
	0xe6, 0x0F,              // INC $0F
	0x38,                    // SEC
	0x69, 0x02,              // ADC #$02
	0x60                     // RTS
];
