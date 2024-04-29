import { existsSync, readdirSync } from "fs";
import { spawnSync } from "child_process"
import { cpus } from "os"
import { fileURLToPath } from "url";
import { join } from "path";

function get_default_toolchain_name() {
    return {
        "win32":"msvc",
        "linux":"gcc",
    }[process.platform]
}

function get_default_architecture() {
    return {
        "win32":"windows-x86_64",
        "linux":"linux-x86_64",
    }[process.platform]
}

function get_toolchain(toolchain_name,architecture) {
    if (!toolchain_name) {
        toolchain_name=get_default_toolchain_name()
    }

    if (!architecture) {
        architecture=get_default_architecture()
    }

    function push_cwd(dirname,relativePath) {
        this.cwd_arr.push(this.cwd)
        this.cwd = join(dirname,relativePath)
    }
    function pop_cwd() {
        this.cwd = this.cwd_arr.pop()
    }

    switch (toolchain_name) {
        case "msvc":
            function get_MSVC_PATH() {
                for (const Year of ["2022","2019"]) {
                    if (existsSync(`C:/Program Files/Microsoft Visual Studio/${Year}`)) {
                        for (const Edition of ["Enterprise","Community","Professional"]) {
                            if (existsSync(`C:/Program Files/Microsoft Visual Studio/${Year}/${Edition}`)) {
                                for (const ToolsVersion of readdirSync(`C:/Program Files/Microsoft Visual Studio/${Year}/${Edition}/VC/Tools/MSVC`).sort().reverse()) {
                                    return {path:`C:/Program Files/Microsoft Visual Studio/${Year}/${Edition}/VC/Tools/MSVC/${ToolsVersion}`,Year,Edition,ToolsVersion}
                                }
                            }
                        }
                    }
                }
            }

            function get_WINSDK_PATH() {
                for (const SDK_Version of readdirSync(`C:/Program Files (x86)/Windows Kits/10/Include`).sort().reverse()) {
                    if (SDK_Version.startsWith("10.")) {
                        return {include:`C:/Program Files (x86)/Windows Kits/10/Include/${SDK_Version}`,bin:`C:/Program Files (x86)/Windows Kits/10/bin/${SDK_Version}`,lib:`C:/Program Files (x86)/Windows Kits/10/Lib/${SDK_Version}`,SDK_Version}
                    }
                }
            }

            const MSVC_PATH = get_MSVC_PATH()
            const WINSDK_PATH = get_WINSDK_PATH()

            const local_arch = {
                "windows-x86_64":"x64",
                "windows-x86":"x86",
            }[architecture]

            const LIB = [`-LIBPATH:${MSVC_PATH.path}/lib/${local_arch}`,`-LIBPATH:${WINSDK_PATH.lib}/um/${local_arch}`,`-LIBPATH:${WINSDK_PATH.lib}/ucrt/${local_arch}`]
            const INCLUDE = [`-I${WINSDK_PATH.include}/ucrt`,`-I${MSVC_PATH.path}/include`]
            const RC_INCLUDE = [`-I${WINSDK_PATH.include}/um`,`-I${WINSDK_PATH.include}/shared`, ...INCLUDE]

            const CC_PATH = `${MSVC_PATH.path}/bin/Hostx64/${local_arch}/cl.exe`
            const LIB_PATH = `${MSVC_PATH.path}/bin/Hostx64/${local_arch}/lib.exe`
            const LINK_PATH = `${MSVC_PATH.path}/bin/Hostx64/${local_arch}/link.exe`
            const RC_PATH = `${WINSDK_PATH.bin}/${local_arch}/rc.exe`
            const msvc = {MSVC_PATH,WINSDK_PATH,LIB,INCLUDE,RC_INCLUDE,CC_PATH}
            return {
                type:"msvc",
                msvc,
                CC: function CC(a) {
                    return {c:CC_PATH,a:[...INCLUDE, ...a],w:{cwd:this.cwd}}
                },
                RC: function RC(a) {
                    return {c:RC_PATH,a:[...RC_INCLUDE, ...a],w:{cwd:this.cwd}}
                },
                AR: function AR(a) {
                    return {c:LIB_PATH,a:a,w:{cwd:this.cwd}}
                },
                LD: function LD(a) {
                    return {c:LINK_PATH,a:[...LIB, ...a],w:{cwd:this.cwd}}
                },
                cwd:null,cwd_arr:[],push_cwd,pop_cwd,
            }
    }
}

function createBucketQueue(maxPriority) {
    const arr = Array.from({length:maxPriority + 1},()=>createResizableCircularQueue())
    return {
        arr:arr,
        currentMaxPriority:-1,
        cachedMax:null,
        insertValue: function insertValue(obj) {
            this.arr[obj.h].putInside(obj)
            if (obj.h > this.currentMaxPriority) {
                this.currentMaxPriority = obj.h
                this.cachedMax = obj
            }
        },
        peekMax: function peekMax() {
            return this.cachedMax
        },
        removeMax: function removeMax() {
            this.arr[this.currentMaxPriority].removeFirstIn()
            for (; this.currentMaxPriority > -1; --this.currentMaxPriority) {
                if (this.cachedMax=this.arr[this.currentMaxPriority].peekFirstIn()) {
                    break
                }
            }
        },
    }
}

function createResizableCircularQueue(initialSize=32) {
    return {
        writeIdx:0,
        used:0,
        arr:Array(initialSize),
        putInside(what) {
            if (this.used===this.arr.length) {
                const newArr = Array(this.arr.length*2)
                for (let i = 0; i < this.writeIdx; ++i) {
                    newArr[i] = this.arr[i]
                }
                for (let i = this.arr.length - 1,j=newArr.length-1; i >= this.writeIdx; --i, --j) {
                    newArr[j] = this.arr[i]
                }
                this.arr = newArr
            }

            this.arr[this.writeIdx] = what
            ++this.writeIdx
            if (this.writeIdx===this.arr.length) {
                this.writeIdx=0
            }
            ++this.used
        },
        getFirstIn() {
            if (this.used) {
                let readIdx = this.writeIdx - this.used
                if (readIdx < 0) {
                    readIdx+=this.arr.length
                }
                const toReturn = this.arr[readIdx]
                --this.used
                return toReturn
            } else {
                return undefined
            }
        },
        peekFirstIn() {
            if (this.used) {
                let readIdx = this.writeIdx - this.used
                if (readIdx < 0) {
                    readIdx+=this.arr.length
                }
                return this.arr[readIdx]
            } else {
                return undefined
            }
        },
        removeFirstIn() {
            if (this.used) {
                --this.used
            }
        },
    }
}

function makeChan() {
    return {
        resizableCircularQueue:createResizableCircularQueue(),
        resolveQueue:createResizableCircularQueue(),
        chanSend(what) {
            let resolve
            if (resolve=this.resolveQueue.getFirstIn()) {
                resolve(what) //lmaoooo, (please do not race)
            } else {
                this.resizableCircularQueue.putInside(what)
            }
        },
        chanReceive() {
            return new Promise(resolve=>{
                const what = this.resizableCircularQueue.getFirstIn()
                if (what !== undefined) {
                    resolve(what)
                } else {
                    this.resolveQueue.putInside(resolve)
                }
            })
        }
    }
}

function frfr() {
    const arr = []
    return {
    independent:function independent(b) {
        return this.attempt({b})
    },
    dependent:function dependent(d,b) {
        return this.attempt({d,b})
    },
    attempt:function attempt(obj) {
        arr.push(obj)
        if (obj.d) {
            for (const v of obj.d) {
                if (v.D) {
                    v.D.push(obj)
                } else {
                    v.D = [obj]
                }
            }
        }
        return obj
    },
    end:async function end() {
        function computeH(v) {
            if (v.h) {
                return
            }
            if (v.D) {
                let maxH = -1
                for (const obj of v.D) {
                    computeH(obj)
                    if (obj.h > maxH) {
                        maxH = obj.h
                    }
                }
                v.h = maxH + 1
            } else {
                v.h = 0
            }
        }
        let maxH = 0
        for (const v of arr) {
            computeH(v)
            v.i = 0
            if (v.d) {
                v.j = v.d.length
            }
            if (v.h > maxH) {
                maxH = v.h
            }
        }
        const bucketQueue = createBucketQueue(maxH)
        this.bucketQueue = bucketQueue
        for (const v of arr) {
            if (!v.d) {
                bucketQueue.insertValue(v)
            }
        }

        const CPU_LOGICAL_CORES_COUNT = cpus().length
        //const CPU_LOGICAL_CORES_COUNT = 3
        const chan = makeChan()
        for (let i = 0; i < CPU_LOGICAL_CORES_COUNT; i++) {
            chan.chanSend(0)
        }
        let waitwaitwait = 0
        while (true) {
            await chan.chanReceive()
            const value = bucketQueue.peekMax()
            if (!value) {
                ++waitwaitwait
                if (waitwaitwait === CPU_LOGICAL_CORES_COUNT) {
                    break
                }
                continue
            }
            for (let i = 0; i < waitwaitwait; i++) {
                chan.chanSend(0)
            }
            waitwaitwait = 0
            const obj = value.b[value.i]
            ++value.i
            if (value.i === value.b.length) {
                bucketQueue.removeMax()
            }
            new Promise(()=>{
                const ok = spawnSync(obj.c,obj.a,obj.w)
                console.log(`${obj.w.cwd}>${obj.c}`,obj.a.join(" "))
                console.log(ok.stdout.toString())
                if (value.i === value.b.length) {
                    if (value.D) {
                        for (const D of value.D) {
                            if (D.j === 1) {
                                bucketQueue.insertValue(D)
                            } else {
                                --D.j
                            }
                        }
                    }
                }
                chan.chanSend(0)
            })
        }

    },
    arr:arr,
    }
}

export function hello(lol,toolchain,toolchain_name,idkArgs={}) {
    toolchain.push_cwd(import.meta.dirname,".")

    switch (toolchain_name) {
        case "msvc":{
            const OBJECTS = lol.independent([
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","adler32.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","compress.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","crc32.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","deflate.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","gzclose.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","gzlib.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","gzread.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","gzwrite.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","infback.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","inflate.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","inftrees.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","inffast.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","trees.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","uncompr.c"]),
                toolchain.CC(["-c","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","zutil.c"]),
            ])

            const RES = lol.independent([toolchain.RC(["/dWIN32","/r","/fozlib1.res","win32/zlib1.rc"])])

            const LIB = lol.dependent([OBJECTS],[toolchain.AR(["-nologo","-out:zlib.lib","adler32.obj","compress.obj","crc32.obj","deflate.obj","gzclose.obj","gzlib.obj","gzread.obj","gzwrite.obj","infback.obj","inflate.obj","inftrees.obj","inffast.obj","trees.obj","uncompr.obj","zutil.obj"])])

            const LINK = lol.dependent([RES,LIB],[toolchain.LD(["-nologo","-debug","-incremental:no","-opt:ref","-def:win32/zlib.def","-dll","-implib:zdll.lib","-out:zlib1.dll","-base:0x5A4C0000","adler32.obj","compress.obj","crc32.obj","deflate.obj","gzclose.obj","gzlib.obj","gzread.obj","gzwrite.obj","infback.obj","inflate.obj","inftrees.obj","inffast.obj","trees.obj","uncompr.obj","zutil.obj","zlib1.res"])])

            if (!idkArgs.skip_tests) {
                const OBJ_EXAMPLE = lol.independent([toolchain.CC(["-c","-I.","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","test/example.c"])])
                const OBJ_MINIGZIP = lol.independent([toolchain.CC(["-c","-I.","-D_CRT_SECURE_NO_DEPRECATE","-D_CRT_NONSTDC_NO_DEPRECATE","-nologo","-MD","-W3","-O2","-Oy-","-Zi","-Fdzlib","test/minigzip.c"])])

                const EXE_EXAMPLE = lol.dependent([OBJ_EXAMPLE,LIB],[toolchain.LD(["-nologo","-debug","-incremental:no","-opt:ref","example.obj","zlib.lib"])])
                const EXE_MINIGZIP = lol.dependent([OBJ_MINIGZIP,LIB],[toolchain.LD(["-nologo","-debug","-incremental:no","-opt:ref","minigzip.obj","zlib.lib"])])

                const EXE_D_EXAMPLE = lol.dependent([OBJ_EXAMPLE,LINK],[toolchain.LD(["-nologo","-debug","-incremental:no","-opt:ref","-out:example_d.exe","example.obj","zdll.lib"])])
                const EXE_D_MINIGZIP = lol.dependent([OBJ_MINIGZIP,LINK],[toolchain.LD(["-nologo","-debug","-incremental:no","-opt:ref","-out:minigzip_d.exe","minigzip.obj","zdll.lib"])])
            }

            break;
        }
    }
    toolchain.pop_cwd()
}

//__main__
if (fileURLToPath(import.meta.url) === process.argv[1]) {
    const args = Object.fromEntries(process.argv.slice(2).map(v=>{
        const pos = v.indexOf("=")
        return [v.slice(0,pos),v.slice(pos+1)]
    }))

    const lol = frfr()
    const toolchain_name = get_default_toolchain_name()
    const toolchain = get_toolchain(toolchain_name,args.ARCH)
    //const toolchain = get_toolchain(toolchain_name,"windows-x86")
    hello(lol,toolchain,toolchain_name)
    await lol.end()
}

debugger