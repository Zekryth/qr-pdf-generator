import { BarCodeScanner } from 'expo-barcode-scanner';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { WebView } from 'react-native-webview';
import { v4 as uuidv4 } from 'uuid';

// Servicio para Google Drive
const uploadPdfToGoogleDrive = async (localUri, fileName) => {
  try {
    const uniqueId = uuidv4().substring(0, 8);
    const safeFileName = `${uniqueId}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(localUri, {
        dialogTitle: `Sube ${safeFileName} a Google Drive y copia el enlace público`,
        mimeType: 'application/pdf'
      });
      
      return {
        success: true,
        message: 'Archivo compartido. Sube a Google Drive y obtén el enlace público.',
        fileName: safeFileName
      };
    } else {
      throw new Error('Sharing no disponible');
    }
  } catch (error) {
    console.error("Error preparando archivo para Google Drive:", error);
    throw error;
  }
};

const App = () => {
  const [selectedPdf, setSelectedPdf] = useState(null);
  const [qrValue, setQrValue] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [hasCameraPerm, setHasCameraPerm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUri, setViewerUri] = useState('');
  const [cloudMode, setCloudMode] = useState(false);
  const [googleDriveUrl, setGoogleDriveUrl] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const qrRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        await MediaLibrary.requestPermissionsAsync();
      } catch (error) {
        console.log('Error requesting permissions:', error);
      }
    })();
  }, []);

  const pickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        multiple: false,
        copyToCacheDirectory: true,
      });
      
      if (result.canceled) return;

      const asset = Array.isArray(result.assets) ? result.assets[0] : result;
      const { uri, name, mimeType } = asset;

      if (!uri) {
        Alert.alert('Error', 'No se pudo obtener el archivo.');
        return;
      }

      const safeName = (name && name.replace(/[^\w.\-]+/g, '_')) || `documento_${Date.now()}.pdf`;
      const destUri = FileSystem.documentDirectory + safeName;

      try {
        await FileSystem.copyAsync({ from: uri, to: destUri });
      } catch (e) {
        const info = await FileSystem.getInfoAsync(destUri);
        if (info.exists) {
          await FileSystem.deleteAsync(destUri, { idempotent: true });
          await FileSystem.copyAsync({ from: uri, to: destUri });
        } else {
          throw e;
        }
      }

      setSelectedPdf({ 
        name: safeName, 
        uri: destUri, 
        mimeType: mimeType || 'application/pdf' 
      });
      setQrValue('');
      setGoogleDriveUrl('');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Falló la selección del PDF.');
    }
  };

  const shareToGoogleDrive = async () => {
    if (!selectedPdf?.uri) {
      Alert.alert('Selecciona un PDF', 'Primero elige un archivo PDF.');
      return;
    }

    try {
      await uploadPdfToGoogleDrive(selectedPdf.uri, selectedPdf.name);
      
      Alert.alert(
        'Sube a Google Drive',
        '1. Selecciona Google Drive en el menú\n2. Súbelo como público\n3. Copia el enlace de compartir\n4. Pégalo en la app\n\n💡 Tip: Haz clic derecho → "Obtener enlace" → "Cualquier persona con el enlace"',
        [
          { text: 'Entendido', onPress: () => setShowUrlInput(true) }
        ]
      );
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo compartir el archivo.');
    }
  };

  const generateQrFromUrl = () => {
    if (!googleDriveUrl.trim()) {
      Alert.alert('URL requerida', 'Pega el enlace de Google Drive.');
      return;
    }

    let directUrl = googleDriveUrl.trim();
    
    // Convertir enlace de Google Drive a vista directa
    if (directUrl.includes('drive.google.com/file/d/')) {
      const fileIdMatch = directUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (fileIdMatch) {
        const fileId = fileIdMatch[1];
        directUrl = `https://drive.google.com/file/d/${fileId}/view`;
      }
    }

    const payload = {
      type: 'qr-pdf-generator-gdrive',
      url: directUrl,
      originalUrl: googleDriveUrl.trim(),
      name: selectedPdf?.name || 'documento.pdf',
      createdAt: Date.now(),
    };

    setQrValue(JSON.stringify(payload));
    setShowUrlInput(false);
    
    Alert.alert('QR Generado', 'El código QR ya contiene el enlace de Google Drive. ¡Compártelo! 🚀');
  };

  const generateQr = async () => {
    if (!selectedPdf?.uri) {
      Alert.alert('Selecciona un PDF', 'Primero elige un archivo PDF.');
      return;
    }

    if (cloudMode) {
      await shareToGoogleDrive();
    } else {
      const payload = {
        type: 'qr-pdf-generator-local',
        name: selectedPdf.name,
        localUri: selectedPdf.uri,
        createdAt: Date.now(),
        platform: Platform.OS,
      };
      setQrValue(JSON.stringify(payload));
    }
  };

  const toPngFile = async () => {
    return new Promise((resolve, reject) => {
      if (!qrRef.current) return reject(new Error('QR no está listo'));
      qrRef.current.toDataURL(async (base64) => {
        try {
          const fileUri = FileSystem.cacheDirectory + `qr_${Date.now()}.png`;
          await FileSystem.writeAsStringAsync(fileUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          resolve(fileUri);
        } catch (err) {
          reject(err);
        }
      });
    });
  };

  const savePng = async () => {
    if (!qrValue) {
      Alert.alert('Genera el QR', 'Primero genera el código QR.');
      return;
    }
    setSaving(true);
    try {
      const fileUri = await toPngFile();
      const asset = await MediaLibrary.createAssetAsync(fileUri);
      await MediaLibrary.createAlbumAsync('QR Codes', asset, false);
      Alert.alert('Guardado', 'Imagen PNG guardada en el álbum "QR Codes". 📱');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo guardar la imagen PNG.');
    } finally {
      setSaving(false);
    }
  };

  const sharePng = async () => {
    if (!qrValue) {
      Alert.alert('Genera el QR', 'Primero genera el código QR.');
      return;
    }
    try {
      const fileUri = await toPngFile();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { dialogTitle: 'Compartir QR' });
      } else {
        Alert.alert('No disponible', 'La compartición no está disponible en este dispositivo.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo compartir la imagen PNG.');
    }
  };

  const openScanner = async () => {
    const { status } = await BarCodeScanner.requestPermissionsAsync();
    setHasCameraPerm(status === 'granted');
    setScannerOpen(true);
  };

  const handleScan = async ({ data }) => {
    try {
      const obj = JSON.parse(data);
      
      if (obj?.type === 'qr-pdf-generator-gdrive' && obj?.url) {
        setViewerUri(obj.url);
        setViewerOpen(true);
        setScannerOpen(false);
        return;
      }
      
      if (obj?.type === 'qr-pdf-generator-local' && obj?.localUri) {
        const info = await FileSystem.getInfoAsync(obj.localUri);
        if (!info.exists) {
          Alert.alert('No encontrado', 'El PDF referenciado no existe en este dispositivo.');
          return;
        }
        
        const opened = await Linking.openURL(obj.localUri).catch(() => false);
        if (!opened) {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(obj.localUri, { dialogTitle: 'Abrir PDF con…' });
          } else {
            Alert.alert('No se pudo abrir', 'Instala un visor de PDF.');
          }
        }
      } else {
        Alert.alert('QR no válido', 'Este QR no pertenece a la app QR PDF Generator.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo leer el QR.');
    } finally {
      setScannerOpen(false);
    }
  };

  const toggleCloudMode = () => {
    setCloudMode(prev => !prev);
    setQrValue('');
    setShowUrlInput(false);
    setGoogleDriveUrl('');
  };

  return (
    <SafeAreaView style={styles.safe} testID="app-root">
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>📱 QR PDF Generator</Text>
        <Text style={styles.subtitle}>by Zekryth</Text>

        <TouchableOpacity style={styles.modeToggle} onPress={toggleCloudMode}>
          <Text style={styles.modeToggleText}>
            Modo: {cloudMode ? '☁️ Google Drive' : '📱 Local'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.buttonPrimary} onPress={pickPdf}>
          <Text style={styles.buttonText}>📄 Seleccionar PDF</Text>
        </TouchableOpacity>

        {selectedPdf?.name ? (
          <Text style={styles.filename} numberOfLines={2}>
            PDF seleccionado: {selectedPdf.name}
          </Text>
        ) : (
          <Text style={styles.hint}>Elige un archivo PDF local.</Text>
        )}

        <TouchableOpacity
          style={[styles.buttonPrimary, !selectedPdf && styles.buttonDisabled]}
          onPress={generateQr}
          disabled={!selectedPdf}
        >
          <Text style={styles.buttonText}>
            {cloudMode ? '☁️ Compartir a Google Drive' : '🔲 Generar QR'}
          </Text>
        </TouchableOpacity>

        {showUrlInput && (
          <View style={styles.urlInputContainer}>
            <Text style={styles.urlInputLabel}>🔗 Pega el enlace de Google Drive:</Text>
            <TextInput
              style={styles.urlInput}
              value={googleDriveUrl}
              onChangeText={setGoogleDriveUrl}
              placeholder="https://drive.google.com/file/d/..."
              multiline={true}
              numberOfLines={3}
            />
            <View style={styles.urlInputButtons}>
              <TouchableOpacity 
                style={[styles.buttonSecondary, !googleDriveUrl.trim() && styles.buttonDisabled]} 
                onPress={generateQrFromUrl}
                disabled={!googleDriveUrl.trim()}
              >
                <Text style={styles.buttonText}>🚀 Generar QR</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.buttonGhost} 
                onPress={() => setShowUrlInput(false)}
              >
                <Text style={styles.buttonGhostText}>❌ Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {qrValue ? (
          <View style={styles.qrWrap}>
            <QRCode
              value={qrValue}
              size={260}
              backgroundColor="#ffffff"
              color="#222222"
              getRef={(c) => (qrRef.current = c)}
            />
            <Text style={styles.qrTypeLabel}>
              {cloudMode ? '☁️ QR con enlace de Google Drive' : '📱 QR con ruta local'}
            </Text>
          </View>
        ) : (
          <View style={styles.qrPlaceholder}>
            <Text style={styles.qrPlaceholderText}>QR aparecerá aquí</Text>
          </View>
        )}

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.buttonSecondary, !qrValue && styles.buttonDisabled]}
            onPress={savePng}
            disabled={!qrValue || saving}
          >
            <Text style={styles.buttonText}>
              {saving ? '💾 Guardando…' : '💾 Guardar PNG'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.buttonSecondary, !qrValue && styles.buttonDisabled]}
            onPress={sharePng}
            disabled={!qrValue}
          >
            <Text style={styles.buttonText}>🔄 Compartir</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.buttonGhost} onPress={openScanner}>
          <Text style={styles.buttonGhostText}>📷 Modo lector (escanear QR)</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Modal Escáner QR */}
      <Modal visible={scannerOpen} animationType="slide">
        <SafeAreaView style={styles.scannerSafe}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>📷 Escanear QR</Text>
            <TouchableOpacity onPress={() => setScannerOpen(false)}>
              <Text style={styles.close}>❌ Cerrar</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.scannerBody}>
            {hasCameraPerm === false ? (
              <Text style={styles.hint}>Permiso de cámara denegado.</Text>
            ) : (
              <BarCodeScanner
                onBarCodeScanned={handleScan}
                style={StyleSheet.absoluteFillObject}
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>

      {/* Modal Visor PDF */}
      <Modal visible={viewerOpen} animationType="slide">
        <SafeAreaView style={styles.viewerSafe}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerTitle}>📄 Visor de PDF</Text>
            <TouchableOpacity onPress={() => setViewerOpen(false)}>
              <Text style={styles.close}>❌ Cerrar</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.viewerBody}>
            {viewerUri ? (
              <WebView 
                source={{ uri: viewerUri }} 
                style={styles.webView} 
              />
            ) : (
              <Text style={styles.hint}>Cargando PDF...</Text>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f8fa' },
  container: { alignItems: 'center', padding: 20, gap: 14 },
  title: { fontSize: 24, fontWeight: '700', color: '#222', marginVertical: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 10 },
  hint: { color: '#666', fontSize: 14, textAlign: 'center' },
  filename: { color: '#333', fontSize: 14, textAlign: 'center', paddingHorizontal: 12 },
  modeToggle: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#e0e0e0', marginBottom: 8 },
  modeToggleText: { fontWeight: '600', color: '#333' },
  urlInputContainer: { width: '100%', backgroundColor: '#fff', padding: 16, borderRadius: 12, elevation: 2, gap: 12 },
  urlInputLabel: { fontWeight: '600', color: '#333' },
  urlInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, textAlignVertical: 'top', fontSize: 14 },
  urlInputButtons: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  buttonPrimary: { backgroundColor: '#4F8EF7', paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, minWidth: 220, shadowColor: '#4F8EF7', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 6 }, shadowRadius: 10, elevation: 4, alignItems: 'center' },
  buttonSecondary: { backgroundColor: '#6CC070', paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, minWidth: 100, alignItems: 'center', elevation: 2 },
  buttonGhost: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, borderColor: '#bfc7d1', minWidth: 100, alignItems: 'center' },
  buttonGhostText: { color: '#3b4a5a', fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700' },
  qrWrap: { backgroundColor: '#fff', padding: 16, borderRadius: 16, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, alignItems: 'center' },
  qrTypeLabel: { marginTop: 8, fontSize: 12, color: '#555', fontStyle: 'italic' },
  qrPlaceholder: { height: 292, width: 292, borderRadius: 16, borderWidth: 1, borderColor: '#E1E6EE', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  qrPlaceholderText: { color: '#9aa3ad' },
  row: { flexDirection: 'row', gap: 12 },
  scannerSafe: { flex: 1, backgroundColor: '#000' },
  scannerHeader: { padding: 16, backgroundColor: '#111', flexDirection: 'row', justifyContent: 'space-between' },
  scannerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  close: { color: '#4F8EF7', fontSize: 16, fontWeight: '700' },
  scannerBody: { flex: 1, overflow: 'hidden' },
  viewerSafe: { flex: 1, backgroundColor: '#fff' },
  viewerHeader: { padding: 16, backgroundColor: '#f0f0f0', flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#ddd' },
  viewerTitle: { color: '#333', fontSize: 18, fontWeight: '700' },
  viewerBody: { flex: 1 },
  webView: { flex: 1 },
});

export default App;