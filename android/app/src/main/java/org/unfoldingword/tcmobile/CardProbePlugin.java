package org.unfoldingword.tcmobile;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.zip.CRC32;

/**
 * THROWAWAY spike probe for #1472 (E7 microSD). Lives on spike/card-store only:
 * it is never merged into develop and never ships to testers. It answers
 * P1-P9 of the issue; the JS side is src/hooks/card-probe.ts, reached only
 * from the phone check on a native Android build. Every failure rejects with a
 * typed code (FULL, UNMOUNTED, IO, NO_SESSION, NOT_FOUND), never a bare string.
 */
@CapacitorPlugin(name = "CardProbe")
public class CardProbePlugin extends Plugin {
    private static final String[] MEDIA_ACTIONS = {
        Intent.ACTION_MEDIA_MOUNTED, Intent.ACTION_MEDIA_UNMOUNTED, Intent.ACTION_MEDIA_EJECT,
        Intent.ACTION_MEDIA_REMOVED, Intent.ACTION_MEDIA_BAD_REMOVAL, Intent.ACTION_MEDIA_CHECKING,
    };

    private final JSArray events = new JSArray();
    private FileOutputStream out;
    private File part;
    private File dest;

    @Override
    public void load() {
        Context ctx = getContext();
        IntentFilter filter = new IntentFilter();
        for (String a : MEDIA_ACTIONS) filter.addAction(a);
        filter.addDataScheme("file");
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                logEvent("broadcast " + i.getAction() + " " + i.getData());
            }
        };
        if (Build.VERSION.SDK_INT >= 33) {
            ctx.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            ctx.registerReceiver(receiver, filter);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            StorageManager sm = ctx.getSystemService(StorageManager.class);
            sm.registerStorageVolumeCallback(ctx.getMainExecutor(), new StorageManager.StorageVolumeCallback() {
                @Override
                public void onStateChanged(StorageVolume v) {
                    logEvent("volumeCallback " + v.getUuid() + " " + v.getState());
                }
            });
        }
    }

    private void logEvent(String what) {
        JSObject e = new JSObject();
        e.put("t", System.currentTimeMillis());
        e.put("what", what);
        events.put(e);
        notifyListeners("cardEvent", e);
    }

    @PluginMethod
    public void events(PluginCall call) {
        JSObject r = new JSObject();
        r.put("events", events);
        call.resolve(r);
    }

    /** P1: every app-specific dir the OS reports, with what it says about the volume. */
    @PluginMethod
    public void volumes(PluginCall call) {
        Context ctx = getContext();
        StorageManager sm = ctx.getSystemService(StorageManager.class);
        JSArray list = new JSArray();
        for (File dir : ctx.getExternalFilesDirs(null)) {
            JSObject v = new JSObject();
            if (dir == null) {
                v.put("path", JSObject.NULL);
                list.put(v);
                continue;
            }
            v.put("path", dir.getAbsolutePath());
            v.put("envState", Environment.getExternalStorageState(dir));
            v.put("freeBytes", dir.getUsableSpace());
            v.put("totalBytes", dir.getTotalSpace());
            StorageVolume sv = sm.getStorageVolume(dir);
            if (sv != null) {
                v.put("removable", sv.isRemovable());
                v.put("primary", sv.isPrimary());
                v.put("emulated", sv.isEmulated());
                v.put("state", sv.getState());
                v.put("uuid", sv.getUuid() == null ? JSObject.NULL : sv.getUuid());
            }
            list.put(v);
        }
        JSObject r = new JSObject();
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        r.put("volumes", list);
        call.resolve(r);
    }

    private static boolean isFull(IOException e) {
        String m = String.valueOf(e.getMessage());
        return m.contains("ENOSPC") || m.contains("No space left");
    }

    private void fail(PluginCall call, File where, IOException e) {
        boolean unmounted = where != null
            && !Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState(where));
        call.reject(String.valueOf(e.getMessage()), unmounted ? "UNMOUNTED" : isFull(e) ? "FULL" : "IO");
    }

    private void closeQuietly() {
        try {
            if (out != null) out.close();
        } catch (IOException ignored) {
            // A failed close on an abandoned probe stream changes nothing the sheet reads.
        }
        out = null;
    }

    /** P2/P4/P6: open NAME.part in DIR; the final name appears only on commit. */
    @PluginMethod
    public void writeStart(PluginCall call) {
        closeQuietly();
        File dir = new File(call.getString("dir", ""));
        dest = new File(dir, call.getString("name", "probe.bin"));
        part = new File(dir, dest.getName() + ".part");
        try {
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("mkdirs failed");
            out = new FileOutputStream(part, false);
            call.resolve();
        } catch (IOException e) {
            fail(call, dir, e);
        }
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        if (out == null) {
            call.reject("no write open", "NO_SESSION");
            return;
        }
        try {
            out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (IOException e) {
            fail(call, part, e);
        }
    }

    /** fsync, close, rename: the whole of the commit the issue asks P2 to time. */
    @PluginMethod
    public void writeCommit(PluginCall call) {
        if (out == null) {
            call.reject("no write open", "NO_SESSION");
            return;
        }
        long t0 = System.nanoTime();
        try {
            out.getFD().sync();
            out.close();
            out = null;
            if (!part.renameTo(dest)) throw new IOException("rename failed");
            JSObject r = new JSObject();
            r.put("path", dest.getAbsolutePath());
            r.put("bytes", dest.length());
            r.put("syncRenameMs", (System.nanoTime() - t0) / 1_000_000);
            call.resolve(r);
        } catch (IOException e) {
            fail(call, part, e);
        }
    }

    /** Close without renaming: leaves the .part behind, as a kill would (P4). */
    @PluginMethod
    public void writeAbandon(PluginCall call) {
        closeQuietly();
        call.resolve();
    }

    /** P4/P7: what is in DIR now, so a restart can show .part or nothing. */
    @PluginMethod
    public void list(PluginCall call) {
        JSArray names = new JSArray();
        File[] files = new File(call.getString("dir", "")).listFiles();
        if (files != null) {
            for (File f : files) names.put(f.getName() + " " + f.length());
        }
        JSObject r = new JSObject();
        r.put("files", names);
        call.resolve(r);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        File f = new File(call.getString("path", ""));
        JSObject r = new JSObject();
        r.put("deleted", f.delete());
        call.resolve(r);
    }

    /** P6: a filler file of exactly BYTES (or until the card says full). */
    @PluginMethod
    public void fill(PluginCall call) {
        File f = new File(call.getString("path", ""));
        long want = call.getData().optLong("bytes", 0);
        byte[] block = new byte[1 << 20];
        try (RandomAccessFile raf = new RandomAccessFile(f, "rw")) {
            raf.setLength(0);
            long done = 0;
            while (done < want) {
                int n = (int) Math.min(block.length, want - done);
                raf.write(block, 0, n);
                done += n;
            }
            raf.getFD().sync();
            JSObject r = new JSObject();
            r.put("bytes", done);
            call.resolve(r);
        } catch (IOException e) {
            fail(call, f, e);
        }
    }

    /** P3: a base64 slice of the file, the read the bridge path would make. */
    @PluginMethod
    public void readChunk(PluginCall call) {
        File f = new File(call.getString("path", ""));
        long at = call.getData().optLong("at", 0);
        int len = call.getInt("length", 384 * 1024);
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            raf.seek(at);
            byte[] buf = new byte[(int) Math.min(len, Math.max(0, raf.length() - at))];
            raf.readFully(buf);
            JSObject r = new JSObject();
            r.put("data", Base64.encodeToString(buf, Base64.NO_WRAP));
            r.put("size", raf.length());
            call.resolve(r);
        } catch (IOException e) {
            call.reject(String.valueOf(e.getMessage()), f.exists() ? "IO" : "NOT_FOUND");
        }
    }

    /** P3: the reference CRC32 both JS reads are compared against. */
    @PluginMethod
    public void crc32(PluginCall call) {
        File f = new File(call.getString("path", ""));
        CRC32 crc = new CRC32();
        byte[] buf = new byte[1 << 16];
        try (FileInputStream in = new FileInputStream(f)) {
            int n;
            while ((n = in.read(buf)) > 0) crc.update(buf, 0, n);
            JSObject r = new JSObject();
            r.put("crc", crc.getValue());
            r.put("bytes", f.length());
            call.resolve(r);
        } catch (IOException e) {
            call.reject(String.valueOf(e.getMessage()), f.exists() ? "IO" : "NOT_FOUND");
        }
    }

    /** P8: the folder picker, with the grant made persistable. */
    @PluginMethod
    public void pickTree(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "treePicked");
    }

    @ActivityCallback
    private void treePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("picker cancelled", "CANCELLED");
            return;
        }
        Uri uri = data.getData();
        getContext().getContentResolver().takePersistableUriPermission(uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        JSObject r = new JSObject();
        r.put("uri", uri.toString());
        call.resolve(r);
    }

    /** P8: each persisted grant and whether its root still resolves right now. */
    @PluginMethod
    public void grants(PluginCall call) {
        JSArray list = new JSArray();
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            JSObject g = new JSObject();
            g.put("uri", p.getUri().toString());
            g.put("write", p.isWritePermission());
            Uri root = DocumentsContract.buildDocumentUriUsingTree(p.getUri(),
                DocumentsContract.getTreeDocumentId(p.getUri()));
            try (Cursor c = getContext().getContentResolver().query(root,
                new String[] {DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                g.put("resolves", c != null && c.moveToFirst());
            } catch (RuntimeException e) {
                g.put("resolves", false);
                g.put("error", e.getClass().getSimpleName());
            }
            list.put(g);
        }
        JSObject r = new JSObject();
        r.put("grants", list);
        call.resolve(r);
    }

    /**
     * P8: write BYTES zero bytes to NAME under the tree with mode "rwt" and sync;
     * a second call with fewer bytes proves no tail remains (final size is read back).
     */
    @PluginMethod
    public void treeWrite(PluginCall call) {
        Uri tree = Uri.parse(call.getString("uri", ""));
        String name = call.getString("name", "tc-probe.bin");
        long bytes = call.getData().optLong("bytes", 0);
        try {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            Uri doc = findChild(tree, name);
            if (doc == null) {
                doc = DocumentsContract.createDocument(getContext().getContentResolver(), parent,
                    "application/octet-stream", name);
            }
            if (doc == null) throw new IOException("createDocument returned null");
            long t0 = System.nanoTime();
            try (ParcelFileDescriptor pfd = getContext().getContentResolver().openFileDescriptor(doc, "rwt");
                 FileOutputStream os = new FileOutputStream(pfd.getFileDescriptor())) {
                byte[] block = new byte[1 << 20];
                for (long done = 0; done < bytes; done += block.length) {
                    os.write(block, 0, (int) Math.min(block.length, bytes - done));
                }
                os.getFD().sync();
            }
            JSObject r = new JSObject();
            r.put("ms", (System.nanoTime() - t0) / 1_000_000);
            r.put("sizeAfter", childSize(doc));
            call.resolve(r);
        } catch (IOException | RuntimeException e) {
            call.reject(String.valueOf(e.getMessage()), e instanceof IOException ? "IO" : "GRANT");
        }
    }

    private Uri findChild(Uri tree, String name) {
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = getContext().getContentResolver().query(kids, new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
            }
        }
        return null;
    }

    private long childSize(Uri doc) {
        try (Cursor c = getContext().getContentResolver().query(doc,
            new String[] {DocumentsContract.Document.COLUMN_SIZE}, null, null, null)) {
            return c != null && c.moveToFirst() ? c.getLong(0) : -1;
        }
    }
}
